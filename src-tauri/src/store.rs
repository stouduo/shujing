use crate::model::ConnInfo;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn conns_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {e}"))?;
    Ok(dir.join("connections.json"))
}

pub fn load_conns(app: &tauri::AppHandle) -> Vec<ConnInfo> {
    let Ok(path) = conns_file(app) else { return vec![] };
    let Ok(text) = fs::read_to_string(path) else { return vec![] };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save_conns(app: &tauri::AppHandle, conns: &[ConnInfo]) -> Result<(), String> {
    let path = conns_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
    }
    let text = serde_json::to_string_pretty(conns).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| format!("写入配置失败: {e}"))
}
