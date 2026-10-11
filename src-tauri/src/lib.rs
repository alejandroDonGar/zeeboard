mod avatars;
mod backup;
mod export;
mod images;
mod ipad;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ipad::IpadState::default())
        // Each plugin is registered once
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build()) // Local SQLite
        .plugin(tauri_plugin_fs::init()) // backups
        .plugin(tauri_plugin_notification::init()) // delivery reminders
        .plugin(tauri_plugin_dialog::init()) // file and folder pickers
        .invoke_handler(tauri::generate_handler![
            images::import_image_from_path,
            images::import_image_from_bytes,
            images::delete_image_files,
            images::cleanup_orphan_images,
            images::storage_stats,
            avatars::fetch_avatar_resource,
            backup::restore_backup,
            export::write_text_file,
            export::read_text_file,
            backup::prepare_backup,
            backup::finish_backup,
            ipad::ipad_start,
            ipad::ipad_stop,
            ipad::ipad_set_snapshot,
            ipad::ipad_addresses,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
