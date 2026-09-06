#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod avatars;
mod repository;
use notify::{RecursiveMode, Watcher};
use repository::*;
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, State};

#[derive(Default)]
struct Session {
    repositories: Mutex<HashMap<PathBuf, Option<notify::RecommendedWatcher>>>,
    writes: Arc<Mutex<()>>,
}
impl Session {
    fn checked(&self, root: &str) -> Result<PathBuf, String> {
        let repositories = self.repositories.lock().map_err(|e| e.to_string())?;
        repositories
            .get_key_value(&PathBuf::from(root))
            .map(|(path, _)| path.clone())
            .ok_or_else(|| "Repository is not open. Reopen it and try again.".into())
    }
}

#[derive(Clone, Serialize)]
struct ChangeEvent {
    root: String,
    history: bool,
}

fn watch(app: tauri::AppHandle, root: PathBuf) -> Result<notify::RecommendedWatcher, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let _ = tx.send(event);
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    let git_dir = PathBuf::from(git_text(&root, &["rev-parse", "--absolute-git-dir"])?.trim());
    let common = PathBuf::from(
        git_text(
            &root,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?
        .trim(),
    );
    for dir in [&git_dir, &common] {
        if !dir.starts_with(&root) {
            watcher
                .watch(dir, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }
    std::thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let mut events = vec![first];
            std::thread::sleep(Duration::from_millis(120));
            events.extend(rx.try_iter());
            let mut relevant = false;
            let mut history = false;
            for event in events.into_iter().flatten() {
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    continue;
                }
                for path in event.paths {
                    if path.extension().is_some_and(|e| e == "lock") {
                        continue;
                    }
                    let rel = path.strip_prefix(&root).unwrap_or(&path);
                    if rel.components().any(|c| {
                        ["node_modules", "target", "dist", ".next"]
                            .iter()
                            .any(|x| c.as_os_str() == *x)
                    }) {
                        continue;
                    }
                    relevant = true;
                    history |= path.starts_with(&git_dir) || path.starts_with(&common);
                }
            }
            if relevant {
                let _ = app.emit(
                    "repo-changed",
                    ChangeEvent {
                        root: root.to_string_lossy().into(),
                        history,
                    },
                );
            }
        }
    });
    Ok(watcher)
}

#[tauri::command]
async fn open_repository(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, Session>,
) -> Result<Snapshot, String> {
    let root = tauri::async_runtime::spawn_blocking(move || discover(&path))
        .await
        .map_err(|e| e.to_string())??;
    let snapshot_root = root.clone();
    let mut snap =
        tauri::async_runtime::spawn_blocking(move || snapshot(&snapshot_root, 500, true))
            .await
            .map_err(|e| e.to_string())??;
    let watcher = watch(app, root.clone());
    snap.watch_warning = watcher.as_ref().err().cloned();
    state
        .repositories
        .lock()
        .map_err(|e| e.to_string())?
        .insert(root, watcher.ok());
    Ok(snap)
}

#[tauri::command]
fn close_repository(root: String, state: State<'_, Session>) -> Result<(), String> {
    state
        .repositories
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&PathBuf::from(root));
    Ok(())
}

#[tauri::command]
async fn commit_avatar(
    root: String,
    oid: String,
    state: State<'_, Session>,
) -> Result<Option<avatars::Avatar>, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || avatars::lookup(&root, &oid))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn refresh_repository(
    root: String,
    limit: usize,
    history: bool,
    state: State<'_, Session>,
) -> Result<Snapshot, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || snapshot(&root, limit.max(100), history))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn commit_details(
    root: String,
    oid: String,
    parent: Option<String>,
    state: State<'_, Session>,
) -> Result<CommitDetails, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || details(&root, &oid, parent.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn file_versions(
    root: String,
    path: String,
    source: String,
    oid: Option<String>,
    parent: Option<String>,
    old_path: Option<String>,
    state: State<'_, Session>,
) -> Result<Versions, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        versions(
            &root,
            &path,
            &source,
            oid.as_deref(),
            parent.as_deref(),
            old_path.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn read_file(
    root: String,
    path: String,
    state: State<'_, Session>,
) -> Result<String, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_working(&root, &path)?.ok_or("File no longer exists.".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn main_file(
    root: String,
    path: String,
    state: State<'_, Session>,
) -> Result<Option<String>, String> {
    let root = state.checked(&root)?;
    tauri::async_runtime::spawn_blocking(move || main_file_contents(&root, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn save_file(
    root: String,
    path: String,
    original: String,
    contents: String,
    state: State<'_, Session>,
) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        save(&root, &path, &original, &contents)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stage_file(
    root: String,
    path: String,
    unstage: bool,
    state: State<'_, Session>,
) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        stage(&root, &path, unstage)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stage_all_changes(
    root: String,
    unstage: bool,
    state: State<'_, Session>,
) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        stage_all(&root, unstage)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn checkout_branch(
    root: String,
    name: String,
    kind: String,
    stash: Option<bool>,
    state: State<'_, Session>,
) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        checkout_with_stash(&root, &name, &kind, stash.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_commit(
    root: String,
    message: String,
    state: State<'_, Session>,
) -> Result<String, String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        if message.trim().is_empty() {
            return Err("Write a commit message first.".into());
        }
        git_text(&root, &["commit", "-m", &message])
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Session::default())
        .invoke_handler(tauri::generate_handler![
            open_repository,
            close_repository,
            commit_avatar,
            refresh_repository,
            commit_details,
            file_versions,
            read_file,
            main_file,
            save_file,
            stage_file,
            stage_all_changes,
            checkout_branch,
            create_commit
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Githeaven");
}

#[cfg(test)]
mod session_tests {
    use super::*;
    #[test]
    fn open_sessions_remain_accessible_until_closed() {
        let session = Session::default();
        let a = PathBuf::from("/repo-a");
        let b = PathBuf::from("/repo-b");
        session.repositories.lock().unwrap().insert(a.clone(), None);
        session.repositories.lock().unwrap().insert(b.clone(), None);
        assert_eq!(session.checked("/repo-a").unwrap(), a);
        assert_eq!(session.checked("/repo-b").unwrap(), b);
        assert!(session.checked("/unopened").is_err());
        session.repositories.lock().unwrap().remove(&a);
        assert!(session.checked("/repo-a").is_err());
        assert!(session.checked("/repo-b").is_ok());
    }
}
