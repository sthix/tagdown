use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn register(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
    app.global_shortcut()
        .on_shortcut("CommandOrControl+Alt+J", |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let _ = app.emit_to("main", "quick-capture-open", ());
            }
        })?;
    Ok(())
}

#[tauri::command]
pub async fn open_quick_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-capture") {
        position_at_cursor(&app, &window)?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window
            .emit("quick-capture-opened", ())
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        &app,
        "quick-capture",
        WebviewUrl::App("index.html?quick-capture".into()),
    )
    .title("Quick capture")
    .inner_size(780.0, 170.0)
    .center()
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|e| e.to_string())?;
    // Fullscreen apps have their own Space on macOS. Join those as an auxiliary window too.
    #[cfg(target_os = "macos")]
    {
        let native = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
                let window = &*(native as *const NSWindow);
                let behavior = window.collectionBehavior()
                    & !(NSWindowCollectionBehavior::FullScreenPrimary
                        | NSWindowCollectionBehavior::FullScreenNone
                        | NSWindowCollectionBehavior::Primary
                        | NSWindowCollectionBehavior::Auxiliary);
                window.setCollectionBehavior(
                    behavior
                        | NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::FullScreenAuxiliary
                        | NSWindowCollectionBehavior::CanJoinAllApplications,
                );
            })
            .map_err(|e| e.to_string())?;
    }
    position_at_cursor(&app, &window)?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn position_at_cursor(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let cursor = app.cursor_position().map_err(|e| e.to_string())?;
    if let Some(monitor) = app
        .monitor_from_point(cursor.x, cursor.y)
        .map_err(|e| e.to_string())?
    {
        let area = monitor.work_area();
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let x = area.position.x + (area.size.width.saturating_sub(size.width) / 2) as i32;
        let y = area.position.y + (area.size.height.saturating_sub(size.height) / 3) as i32;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
