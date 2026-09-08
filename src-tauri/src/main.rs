#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod avatars;
mod repository;
mod startup;
use notify::{RecursiveMode, Watcher};
use repository::*;
use serde::Serialize;
use startup::{startup_milestone, Milestone, Startup};
use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tauri::{Emitter, Manager, State};

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
    categories: BTreeSet<&'static str>,
}

fn watch_category(path: &Path, git_dir: &Path, common: &Path) -> &'static str {
    let Ok(relative) = path
        .strip_prefix(git_dir)
        .or_else(|_| path.strip_prefix(common))
    else {
        return "worktree";
    };
    if relative == Path::new("index") {
        "index"
    } else if relative == Path::new("HEAD") {
        "head"
    } else if relative.starts_with("refs") || relative == Path::new("packed-refs") {
        "refs"
    } else if relative.starts_with("objects") {
        "objects"
    } else {
        "metadata"
    }
}

#[cfg(test)]
fn changes_history(path: &Path, git_dir: &Path, common: &Path) -> bool {
    !matches!(watch_category(path, git_dir, common), "worktree" | "index")
}

// Merge before queueing: at most six category labels and one wake-up are
// retained, regardless of how many raw paths arrive during the debounce window.
fn queue_watch_categories(
    tx: &std::sync::mpsc::SyncSender<()>,
    pending: &Mutex<BTreeSet<&'static str>>,
    categories: BTreeSet<&'static str>,
) {
    if categories.is_empty() {
        return;
    }
    pending.lock().unwrap().extend(categories);
    // A full channel already has a wake-up for the merged pending categories.
    let _ = tx.try_send(());
}

fn event_categories(
    event: notify::Event,
    root: &Path,
    git_dir: &Path,
    common: &Path,
) -> BTreeSet<&'static str> {
    let mut categories = BTreeSet::new();
    if matches!(event.kind, notify::EventKind::Access(_)) {
        return categories;
    }
    for path in event.paths {
        if path.extension().is_some_and(|e| e == "lock") {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path);
        if rel.components().any(|c| {
            ["node_modules", "target", "dist", ".next"]
                .iter()
                .any(|x| c.as_os_str() == *x)
        }) {
            continue;
        }
        categories.insert(watch_category(&path, git_dir, common));
    }
    categories
}

fn watch(app: tauri::AppHandle, root: PathBuf) -> Result<notify::RecommendedWatcher, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let pending = Arc::new(Mutex::new(BTreeSet::new()));
    let callback_pending = pending.clone();
    let callback_root = root.clone();
    let directories = Arc::new(OnceLock::<(PathBuf, PathBuf)>::new());
    let callback_directories = directories.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            let categories = if let Some((git_dir, common)) = callback_directories.get() {
                event_categories(event, &callback_root, git_dir, common)
            } else {
                // Subscribe to the root before resolving Git directories, as
                // before. Early relevant events conservatively request history.
                let early = event_categories(event, &callback_root, &callback_root, &callback_root);
                if early.is_empty() {
                    early
                } else {
                    BTreeSet::from(["metadata"])
                }
            };
            queue_watch_categories(&tx, &callback_pending, categories);
        }
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
    let _ = directories.set((git_dir.clone(), common.clone()));
    for dir in [&git_dir, &common] {
        if !dir.starts_with(&root) {
            watcher
                .watch(dir, RecursiveMode::Recursive)
                .map_err(|e| e.to_string())?;
        }
    }
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            std::thread::sleep(Duration::from_millis(120));
            let categories = std::mem::take(&mut *pending.lock().unwrap());
            if !categories.is_empty() {
                let history = categories
                    .iter()
                    .any(|category| !matches!(*category, "worktree" | "index"));
                let _ = app.emit(
                    "repo-changed",
                    ChangeEvent {
                        root: root.to_string_lossy().into(),
                        history,
                        categories,
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
    startup: State<'_, Startup>,
) -> Result<Snapshot, String> {
    let root = tauri::async_runtime::spawn_blocking(move || discover(&path))
        .await
        .map_err(|e| e.to_string())??;
    let _ = startup.record(Milestone::RepositoryDiscovery);
    let snapshot_root = root.clone();
    let mut snap =
        tauri::async_runtime::spawn_blocking(move || snapshot(&snapshot_root, 500, true))
            .await
            .map_err(|e| e.to_string())??;
    let _ = startup.record(Milestone::RepositorySnapshot);
    let watcher = watch(app, root.clone());
    let _ = startup.record(Milestone::RepositoryWatch);
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
async fn pull_branch(root: String, state: State<'_, Session>) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        pull(&root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn push_branch(root: String, state: State<'_, Session>) -> Result<(), String> {
    let root = state.checked(&root)?;
    let lock = state.writes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().map_err(|e| e.to_string())?;
        push(&root)
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

#[tauri::command]
async fn export_performance_report(app: tauri::AppHandle, report: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    if report.len() > 2 * 1024 * 1024 {
        return Err("Performance report exceeds 2 MB.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .add_filter("JSON report", &["json"])
            .set_directory(std::env::temp_dir())
            .set_file_name("githeaven-performance.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        std::fs::write(path, report).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    let startup = Startup::new();
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(Session::default())
        .manage(startup)
        .setup(|app| {
            let _ = app.state::<Startup>().record(Milestone::Setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup_milestone,
            export_performance_report,
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
            create_commit,
            push_branch,
            pull_branch
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Githeaven");
}

#[cfg(test)]
mod session_tests {
    use super::*;
    #[test]
    fn watcher_bursts_retain_one_wakeup_and_union_all_categories() {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let pending = Mutex::new(BTreeSet::new());
        let labels = ["worktree", "index", "head", "refs", "objects", "metadata"];
        for index in 0..100_000 {
            queue_watch_categories(
                &tx,
                &pending,
                BTreeSet::from([labels[index % labels.len()]]),
            );
        }
        assert_eq!(rx.try_iter().count(), 1);
        assert_eq!(*pending.lock().unwrap(), BTreeSet::from(labels));
    }
    #[test]
    fn watcher_updates_survive_debounce_and_drain_boundaries() {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let pending = Mutex::new(BTreeSet::new());
        queue_watch_categories(&tx, &pending, BTreeSet::from(["index"]));
        rx.recv().unwrap(); // Consumer begins its debounce window.
        queue_watch_categories(&tx, &pending, BTreeSet::from(["objects"]));
        queue_watch_categories(&tx, &pending, BTreeSet::from(["refs"]));
        assert_eq!(
            std::mem::take(&mut *pending.lock().unwrap()),
            BTreeSet::from(["index", "objects", "refs"])
        );
        // The queued wake-up is still full when a new event follows the drain.
        queue_watch_categories(&tx, &pending, BTreeSet::from(["head"]));
        rx.recv().unwrap();
        assert_eq!(
            std::mem::take(&mut *pending.lock().unwrap()),
            BTreeSet::from(["head"])
        );
        queue_watch_categories(&tx, &pending, BTreeSet::new());
        assert!(rx.try_recv().is_err());
        drop(tx);
        assert!(rx.recv().is_err()); // Dropping the watcher still ends the thread.
    }
    #[test]
    fn ignored_events_do_not_enter_the_pending_watcher_batch() {
        let root = Path::new("repo");
        let git_dir = root.join(".git");
        let event = notify::Event::new(notify::EventKind::Any)
            .add_path(root.join("node_modules/a.js"))
            .add_path(root.join("target/output"))
            .add_path(git_dir.join("index.lock"));
        assert!(event_categories(event, root, &git_dir, &git_dir).is_empty());
        let access = notify::Event::new(notify::EventKind::Access(notify::event::AccessKind::Any))
            .add_path(root.join("source.txt"));
        assert!(event_categories(access, root, &git_dir, &git_dir).is_empty());
        let mixed = notify::Event::new(notify::EventKind::Any)
            .add_path(git_dir.join("index"))
            .add_path(git_dir.join("refs/heads/topic"))
            .add_path(root.join("source.txt"));
        assert_eq!(
            event_categories(mixed, root, &git_dir, &git_dir),
            BTreeSet::from(["index", "refs", "worktree"])
        );
    }
    #[test]
    fn watcher_categories_expose_only_fixed_labels() {
        let common = Path::new("repo/.git");
        let worktree = common.join("worktrees/topic");
        for (path, expected) in [
            (worktree.join("index"), "index"),
            (worktree.join("HEAD"), "head"),
            (common.join("refs/heads/private-name"), "refs"),
            (common.join("packed-refs"), "refs"),
            (common.join("objects/ab/private-object"), "objects"),
            (common.join("config"), "metadata"),
            (PathBuf::from("repo/private-file.txt"), "worktree"),
        ] {
            assert_eq!(watch_category(&path, &worktree, common), expected);
        }
        let event = ChangeEvent {
            root: "repo".into(),
            history: true,
            categories: BTreeSet::from(["index", "objects", "index"]),
        };
        assert_eq!(
            serde_json::to_value(event).unwrap()["categories"],
            serde_json::json!(["index", "objects"])
        );
    }
    #[test]
    fn index_events_refresh_status_without_reloading_history() {
        let common = Path::new("repo/.git");
        for git_dir in [common, Path::new("repo/.git/worktrees/topic")] {
            assert!(!changes_history(&git_dir.join("index"), git_dir, common));
            assert!(!changes_history(
                Path::new("repo/src/index"),
                git_dir,
                common
            ));
            for path in [
                git_dir.join("HEAD"),
                common.join("refs/heads/main"),
                common.join("packed-refs"),
                common.join("objects/ab/cd"),
                common.to_path_buf(),
                git_dir.to_path_buf(),
            ] {
                assert!(changes_history(&path, git_dir, common), "{path:?}");
            }
            // A batch containing an index update and a ref update must still
            // request history, regardless of which event arrives first.
            assert!([git_dir.join("index"), common.join("refs/heads/main")]
                .iter()
                .any(|path| changes_history(path, git_dir, common)));
        }
    }
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
