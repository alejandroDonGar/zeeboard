//! Restore a backup made with "Export backup":
//! a folder with `zeeboard.db` and `images/` (and `images/thumbs/`).
//!
//! The frontend closes the database first (Windows won't replace an open file)
//! and reloads the app afterwards; on startup, migrations update old backups.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const DB_FILE: &str = "zeeboard.db";

fn is_sqlite_file(path: &Path) -> bool {
    let mut header = [0u8; 16];
    fs::File::open(path)
        .and_then(|mut file| std::io::Read::read_exact(&mut file, &mut header))
        .map(|_| &header == b"SQLite format 3\0")
        .unwrap_or(false)
}

/// Copies files from `from` to `to` that don't exist there yet. Images are named by their
/// content, so a repeated name is the same image: nothing is ever overwritten or deleted.
fn copy_missing_files(from: &Path, to: &Path) -> Result<u32, String> {
    let Ok(entries) = fs::read_dir(from) else {
        return Ok(0);
    };

    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    let mut copied = 0;

    for entry in entries.flatten() {
        let target = to.join(entry.file_name());

        if entry.path().is_file() && !target.exists() {
            fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
            copied += 1;
        }
    }

    Ok(copied)
}

/// Returns the folder holding the safety copy of the data that was there before.
fn restore(backup_dir: &Path, data_dir: &Path, stamp: &str) -> Result<PathBuf, String> {
    let backup_db = backup_dir.join(DB_FILE);

    if !is_sqlite_file(&backup_db) {
        return Err(format!(
            "{} doesn't look like a ZeeBoard backup (no valid {DB_FILE} inside)",
            backup_dir.display()
        ));
    }

    // The stamp names a folder: only digits and dashes, so it can never point outside before-restore/
    if stamp.is_empty() || !stamp.chars().all(|c| c.is_ascii_digit() || c == '-') {
        return Err(format!("Invalid restore stamp: {stamp}"));
    }

    // 1. Safety copy of the current data, in case the backup wasn't the one you wanted
    let safety_dir = data_dir.join("before-restore").join(stamp);
    fs::create_dir_all(&safety_dir).map_err(|error| error.to_string())?;

    for name in [DB_FILE, "zeeboard.db-wal", "zeeboard.db-shm", "zeeboard.db-journal"] {
        let current = data_dir.join(name);

        if current.exists() {
            fs::copy(&current, safety_dir.join(name)).map_err(|error| error.to_string())?;
        }
    }

    // 2. Leftover journal of the current database: applied to the restored one it would corrupt it
    for name in ["zeeboard.db-wal", "zeeboard.db-shm", "zeeboard.db-journal"] {
        let _ = fs::remove_file(data_dir.join(name));
    }

    // 3. The backup's database and images
    fs::copy(&backup_db, data_dir.join(DB_FILE)).map_err(|error| error.to_string())?;
    copy_missing_files(&backup_dir.join("images"), &data_dir.join("images"))?;
    copy_missing_files(&backup_dir.join("images").join("thumbs"), &data_dir.join("images").join("thumbs"))?;

    Ok(safety_dir)
}

const BACKUP_PREFIX: &str = "zeeboard-backup-";

/// Only folders with the exact name of ZeeBoard backups are rotated (deleted),
/// e.g. `zeeboard-backup-2026-10-06-1318`: never anything else in that folder.
fn is_backup_name(name: &str) -> bool {
    let Some(stamp) = name.strip_prefix(BACKUP_PREFIX) else {
        return false;
    };

    stamp.len() == 15
        && stamp.chars().enumerate().all(|(index, character)| {
            if matches!(index, 4 | 7 | 10) { character == '-' } else { character.is_ascii_digit() }
        })
}

/// Keeps only the `keep` most recent backups in `root` (names sort by date).
fn prune_backups(root: &Path, keep: usize) -> u32 {
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };

    let mut backups: Vec<PathBuf> = entries
        .flatten()
        // file_type doesn't follow symlinks: a link never counts as a folder
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .filter(|entry| is_backup_name(&entry.file_name().to_string_lossy()))
        .map(|entry| entry.path())
        .collect();

    backups.sort();
    let excess = backups.len().saturating_sub(keep);

    backups.iter().take(excess).filter(|path| fs::remove_dir_all(path).is_ok()).count() as u32
}

fn discard_backup(dir: &Path) {
    if dir.file_name().is_some_and(|name| is_backup_name(&name.to_string_lossy())) {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Second half of a backup: the database is already in `dir` (the SQLite `VACUUM INTO` copy
/// is made by the frontend). Adds the images and, if asked, rotates old backups.
/// On failure it leaves no half-made folder that looks like a good backup.
fn finish(data_dir: &Path, dir: &Path, keep: Option<usize>) -> Result<u32, String> {
    if !is_sqlite_file(&dir.join(DB_FILE)) {
        discard_backup(dir);
        return Err("The database copy failed, so the backup was discarded".to_string());
    }

    let images = copy_missing_files(&data_dir.join("images"), &dir.join("images"))
        .and_then(|_| copy_missing_files(&data_dir.join("images").join("thumbs"), &dir.join("images").join("thumbs")));

    if let Err(error) = images {
        discard_backup(dir);
        return Err(error);
    }

    Ok(match (keep, dir.parent()) {
        // With at least 1, the backup just made is never deleted
        (Some(keep), Some(root)) => prune_backups(root, keep.max(1)),
        _ => 0,
    })
}

/// First half of a backup: creates the folder (and any missing parents).
#[tauri::command]
pub fn prepare_backup(dir: String) -> Result<(), String> {
    let dir = Path::new(&dir);

    if dir.exists() {
        return Err(format!("{} already exists. Wait a minute and try again", dir.display()));
    }

    fs::create_dir_all(dir).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn finish_backup(app: AppHandle, dir: String, keep: Option<usize>) -> Result<u32, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;

    finish(&data_dir, Path::new(&dir), keep)
}

#[tauri::command]
pub fn restore_backup(app: AppHandle, backup_dir: String, stamp: String) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;

    restore(Path::new(&backup_dir), &data_dir, &stamp).map(|path| path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zeeboard-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn restores_database_and_merges_images_keeping_a_safety_copy() {
        let backup = temp_dir("backup");
        let data = temp_dir("data");

        fs::write(backup.join(DB_FILE), b"SQLite format 3\0backup").unwrap();
        fs::create_dir_all(backup.join("images/thumbs")).unwrap();
        fs::write(backup.join("images/old.webp"), b"old").unwrap();
        fs::write(backup.join("images/thumbs/old.webp"), b"old thumb").unwrap();

        fs::write(data.join(DB_FILE), b"SQLite format 3\0current").unwrap();
        fs::write(data.join("zeeboard.db-wal"), b"stale").unwrap();
        fs::create_dir_all(data.join("images")).unwrap();
        fs::write(data.join("images/new.webp"), b"new").unwrap();

        let safety = restore(&backup, &data, "2026-10-13-0930").unwrap();

        assert_eq!(fs::read(data.join(DB_FILE)).unwrap(), b"SQLite format 3\0backup");
        assert!(!data.join("zeeboard.db-wal").exists());
        assert!(data.join("images/old.webp").exists());
        assert!(data.join("images/thumbs/old.webp").exists());
        assert!(data.join("images/new.webp").exists(), "current images are never deleted");
        assert_eq!(fs::read(safety.join(DB_FILE)).unwrap(), b"SQLite format 3\0current");
        assert_eq!(fs::read(safety.join("zeeboard.db-wal")).unwrap(), b"stale");
    }

    #[test]
    fn refuses_a_folder_without_a_database() {
        let backup = temp_dir("empty");
        let data = temp_dir("data-untouched");
        fs::write(data.join(DB_FILE), b"SQLite format 3\0current").unwrap();

        assert!(restore(&backup, &data, "2026-10-13-0930").is_err());
        assert_eq!(fs::read(data.join(DB_FILE)).unwrap(), b"SQLite format 3\0current");
        assert!(!data.join("before-restore").exists(), "nothing is touched when the backup is invalid");
    }

    #[test]
    fn refuses_a_stamp_that_could_leave_the_folder() {
        let backup = temp_dir("stamp-backup");
        let data = temp_dir("stamp-data");
        fs::write(backup.join(DB_FILE), b"SQLite format 3\0backup").unwrap();
        fs::write(data.join(DB_FILE), b"SQLite format 3\0current").unwrap();

        for stamp in ["../evil", r"..\evil", r"C:\x", ""] {
            assert!(restore(&backup, &data, stamp).is_err(), "{stamp:?}");
        }
        assert_eq!(fs::read(data.join(DB_FILE)).unwrap(), b"SQLite format 3\0current");
        assert!(!data.join("before-restore").exists());
    }

    #[test]
    fn only_exact_backup_names_are_rotated() {
        assert!(is_backup_name("zeeboard-backup-2026-10-06-1318"));
        assert!(!is_backup_name("zeeboard-backup-2026-10-06"));
        assert!(!is_backup_name("zeeboard-backup-2026-10-06-1318-old"));
        assert!(!is_backup_name("my-photos"));
    }

    #[test]
    fn prune_keeps_the_newest_and_never_touches_other_folders() {
        let root = temp_dir("prune");

        for name in ["zeeboard-backup-2026-10-01-0900", "zeeboard-backup-2026-10-03-0900", "zeeboard-backup-2026-10-05-0900"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        fs::create_dir_all(root.join("my-photos")).unwrap();
        fs::write(root.join("notes.txt"), b"keep me").unwrap();

        assert_eq!(prune_backups(&root, 2), 1);
        assert!(!root.join("zeeboard-backup-2026-10-01-0900").exists(), "the oldest goes");
        assert!(root.join("zeeboard-backup-2026-10-03-0900").exists());
        assert!(root.join("zeeboard-backup-2026-10-05-0900").exists());
        assert!(root.join("my-photos").exists() && root.join("notes.txt").exists());
    }

    #[test]
    fn finish_adds_images_and_rotates_but_discards_a_backup_without_database() {
        let data = temp_dir("finish-data");
        let root = temp_dir("finish-root");
        fs::create_dir_all(data.join("images/thumbs")).unwrap();
        fs::write(data.join("images/a.webp"), b"a").unwrap();
        fs::write(data.join("images/thumbs/a.webp"), b"t").unwrap();

        let old = root.join("zeeboard-backup-2026-10-01-0900");
        fs::create_dir_all(&old).unwrap();

        let good = root.join("zeeboard-backup-2026-10-06-0900");
        fs::create_dir_all(&good).unwrap();
        fs::write(good.join(DB_FILE), b"SQLite format 3\0db").unwrap();

        assert_eq!(finish(&data, &good, Some(1)).unwrap(), 1);
        assert!(good.join("images/a.webp").exists() && good.join("images/thumbs/a.webp").exists());
        assert!(!old.exists(), "rotated away");

        let broken = root.join("zeeboard-backup-2026-10-07-0900");
        fs::create_dir_all(&broken).unwrap();

        assert!(finish(&data, &broken, Some(1)).is_err());
        assert!(!broken.exists(), "a half-made backup is removed");
        assert!(good.exists(), "and the good one is untouched");
    }
}
