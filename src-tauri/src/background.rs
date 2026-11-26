//! Running in the background: ZeeBoard opens with Windows hidden in the tray, and closing the window keeps it
//! there, so delivery reminders arrive with the window closed. One switch in Settings; its state is Windows' own
//! startup entry (read here every time), so there is nothing else to keep in sync.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, Window, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt;

/// Added by the Windows startup entry: start hidden in the tray
pub const HIDDEN: &str = "--hidden";

/// The tray menu's items, renamed by the frontend into the app's language
pub struct TrayItems(MenuItem<Wry>, MenuItem<Wry>);

fn enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The tray icon (click: open; menu: open, quit), and the window, which stays hidden only when Windows started the app
pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open ZeeBoard", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::new()
        .tooltip("ZeeBoard")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayItems(open, quit));

    if !std::env::args().any(|arg| arg == HIDDEN) {
        show(app.handle());
    }
    Ok(())
}

/// Closing the window while running in the background only hides it
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if enabled(window.app_handle()) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

#[tauri::command]
pub fn background_enabled(app: AppHandle) -> bool {
    enabled(&app)
}

#[tauri::command]
pub fn set_background(app: AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if on { launcher.enable() } else { launcher.disable() }.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn tray_labels(items: State<TrayItems>, open: String, quit: String) {
    let _ = items.0.set_text(open);
    let _ = items.1.set_text(quit);
}
