//! CSV files in and out. The web side never passes a path: Rust opens the save or open dialog itself and only touches
//! the file the user chose there (or, for the form responses, the one they chose there before).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// Where the chosen form-responses CSV is remembered: in the app data folder, written only after the user picks it.
const REMEMBERED: &str = "responses-file.txt";

fn remember(data_dir: &Path, file: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    fs::write(data_dir.join(REMEMBERED), file.to_string_lossy().as_bytes()).map_err(|error| error.to_string())
}

/// The remembered file's text; None when none was chosen yet (or it was chosen in a version without this).
fn read_remembered(data_dir: &Path) -> Result<Option<String>, String> {
    let Ok(path) = fs::read_to_string(data_dir.join(REMEMBERED)) else {
        return Ok(None);
    };

    read_text(Path::new(path.trim())).map(Some)
}

fn read_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("Could not read {}: {error}", path.display()))
}

/// With a BOM first, so Excel reads accents and the ñ correctly.
fn write_csv(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, format!("\u{feff}{contents}")).map_err(|error| format!("Could not write {}: {error}", path.display()))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

/// "Save as…" for an export: Rust asks where and writes there. Returns the path, or None if cancelled.
/// Async so the dialog doesn't block the main thread.
#[tauri::command]
pub async fn save_csv(app: AppHandle, file_name: String, contents: String) -> Result<Option<String>, String> {
    let Some(chosen) = app.dialog().file().set_file_name(file_name).add_filter("CSV", &["csv"]).blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|error| error.to_string())?;

    write_csv(&path, &contents)?;
    Ok(Some(path.display().to_string()))
}

#[derive(Serialize)]
pub struct PickedCsv {
    path: String,
    text: String,
}

/// "Open…" for a CSV (PayPal activity, form responses): Rust asks which and reads it. With `remember`, that file can be
/// read again later with `read_remembered_csv`, without asking. None if cancelled.
#[tauri::command]
pub async fn open_csv(app: AppHandle, title: String, remember_it: bool) -> Result<Option<PickedCsv>, String> {
    let Some(chosen) = app.dialog().file().set_title(title).add_filter("CSV", &["csv"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = chosen.into_path().map_err(|error| error.to_string())?;
    let text = read_text(&path)?;

    if remember_it {
        remember(&data_dir(&app)?, &path)?;
    }

    Ok(Some(PickedCsv { path: path.display().to_string(), text }))
}

/// The form-responses CSV chosen with `open_csv(…, remember_it)`; None if none was chosen yet.
#[tauri::command]
pub fn read_remembered_csv(app: AppHandle) -> Result<Option<String>, String> {
    read_remembered(&data_dir(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zeeboard-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_the_file_chosen_in_the_dialog_is_read() {
        let data = temp_dir("remembered-data");
        assert_eq!(read_remembered(&data).unwrap(), None);

        let csv = data.join("responses.csv");
        fs::write(&csv, "Timestamp,Handle\n").unwrap();
        remember(&data, &csv).unwrap();
        assert_eq!(read_remembered(&data).unwrap().as_deref(), Some("Timestamp,Handle\n"));
    }

    #[test]
    fn a_remembered_file_that_is_gone_says_which_one() {
        let data = temp_dir("remembered-gone");
        remember(&data, &data.join("moved.csv")).unwrap();
        assert!(read_remembered(&data).unwrap_err().contains("moved.csv"));
    }

    #[test]
    fn the_csv_starts_with_a_bom_for_excel() {
        let dir = temp_dir("csv-bom");
        let path = dir.join("out.csv");
        write_csv(&path, "Title;Price\r\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), "\u{feff}Title;Price\r\n".as_bytes());
    }
}
