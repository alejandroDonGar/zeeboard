mod avatars;
mod background;
mod access;
mod backup;
mod export;
mod images;
mod ipad;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ipad::IpadState::default())
        // Each plugin is registered once. Single instance first: opening ZeeBoard again shows the one already running
        // (in the tray, perhaps) instead of a second copy writing to the same database
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| background::show(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![background::HIDDEN])))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build()) // Local SQLite
        .plugin(tauri_plugin_fs::init()) // backups
        .plugin(tauri_plugin_notification::init()) // delivery reminders
        .plugin(tauri_plugin_dialog::init()) // file and folder pickers
        .setup(|app| Ok(background::setup(app)?))
        .on_window_event(background::on_window_event)
        .invoke_handler(tauri::generate_handler![
            images::import_image_from_path,
            images::import_image_from_bytes,
            images::delete_image_files,
            images::cleanup_orphan_images,
            images::storage_stats,
            avatars::fetch_avatar_resource,
            backup::restore_backup,
            backup::remember_backup_folder,
            backup::remembered_backup_folder,
            export::save_csv,
            export::open_csv,
            export::read_remembered_csv,
            backup::prepare_backup,
            backup::finish_backup,
            ipad::ipad_start,
            ipad::ipad_stop,
            ipad::ipad_set_snapshot,
            ipad::ipad_addresses,
            background::background_enabled,
            background::set_background,
            background::tray_labels,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
