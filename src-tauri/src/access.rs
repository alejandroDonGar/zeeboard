//! Which paths the Rust commands may touch. The web side names a path, but a path is only used if:
//! it is inside the app's data folder, the user chose or dropped it this session (Tauri records those in the asset
//! scope), or it is the automatic-backup folder remembered when the user chose it. Never anything with `..`.

use std::path::{Component, Path};

pub fn allowed(path: &Path, data_dir: &Path, picked: impl Fn(&Path) -> bool, remembered: Option<&Path>) -> bool {
    // `starts_with` compares components: with `..` a path could look inside the data folder and point outside it
    if path.components().any(|component| component == Component::ParentDir) {
        return false;
    }

    path.starts_with(data_dir) || remembered == Some(path) || picked(path)
}

/// The same check for a command: the error says what happened instead of touching the file.
pub fn check(path: &Path, data_dir: &Path, picked: impl Fn(&Path) -> bool, remembered: Option<&Path>) -> Result<(), String> {
    if allowed(path, data_dir, picked, remembered) {
        Ok(())
    } else {
        Err(format!("ZeeBoard only opens files and folders you chose or dropped, and {} isn't one", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const DATA: &str = r"C:\Users\demo\AppData\Roaming\com.zeeboard.app";

    fn nothing(_: &Path) -> bool {
        false
    }

    #[test]
    fn the_data_folder_is_allowed() {
        assert!(allowed(&Path::new(DATA).join(r"images\a.webp"), Path::new(DATA), nothing, None));
        assert!(allowed(&Path::new(DATA).join("before-cleanup"), Path::new(DATA), nothing, None));
    }

    #[test]
    fn anything_else_needs_the_user_to_have_chosen_it() {
        let file = PathBuf::from(r"C:\Users\demo\Pictures\fox.png");
        assert!(!allowed(&file, Path::new(DATA), nothing, None));
        assert!(allowed(&file, Path::new(DATA), |path| path == file, None));
    }

    #[test]
    fn the_remembered_backup_folder_is_allowed_after_a_restart() {
        let folder = PathBuf::from(r"D:\Backups");
        assert!(allowed(&folder, Path::new(DATA), nothing, Some(&folder)));
        assert!(!allowed(Path::new(r"D:\Other"), Path::new(DATA), nothing, Some(&folder)));
    }

    #[test]
    fn going_up_with_dots_is_never_allowed() {
        let escape = Path::new(DATA).join(r"..\..\..\Microsoft\Windows\Start Menu");
        assert!(!allowed(&escape, Path::new(DATA), |_| true, None));
        assert!(check(&escape, Path::new(DATA), nothing, None).unwrap_err().contains("chose"));
    }
}
