mod task_store;
mod tool_gateway;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(tool_gateway::ToolGatewayState::default())
        .invoke_handler(tauri::generate_handler![
            tool_gateway::authorize_workspace_root,
            tool_gateway::workspace_status,
            tool_gateway::prepare_tool_call,
            tool_gateway::resolve_tool_permission,
            tool_gateway::execute_tool_call,
            task_store::save_task_snapshot,
            task_store::list_task_snapshots,
            task_store::load_task_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nova");
}
