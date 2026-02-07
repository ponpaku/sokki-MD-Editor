use std::sync::Mutex;
use tauri::{Emitter, Manager};

struct InitialFile(Mutex<Option<String>>);

fn is_markdown_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

fn find_md_arg(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| is_markdown_file(a))
        .cloned()
}

#[tauri::command]
fn get_initial_file(state: tauri::State<'_, InitialFile>) -> Option<String> {
    state.0.lock().unwrap().take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = find_md_arg(&argv) {
                let _ = app.emit("file-open", path);
            }
            // Focus existing window
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(InitialFile(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_initial_file])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(path) = find_md_arg(&args) {
                // Store for frontend to pick up via get_initial_file command
                let state = app.state::<InitialFile>();
                *state.0.lock().unwrap() = Some(path);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
