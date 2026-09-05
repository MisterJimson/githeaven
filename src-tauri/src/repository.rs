use serde::Serialize;
use std::{
    collections::BTreeSet,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
    time::Instant,
};

const MAX_FILE: usize = 2 * 1024 * 1024;

#[derive(Clone, Serialize, Debug)]
pub struct Change {
    pub path: String,
    pub original_path: Option<String>,
    pub index: char,
    pub worktree: char,
}
#[derive(Serialize)]
pub struct Commit {
    pub oid: String,
    pub parents: Vec<String>,
    pub author: String,
    pub timestamp: i64,
    pub subject: String,
}
#[derive(Serialize)]
pub struct Reference {
    pub name: String,
    pub oid: String,
    pub kind: String,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub root: String,
    pub name: String,
    pub branch: String,
    pub head: Option<String>,
    pub files: Vec<String>,
    pub changes: Vec<Change>,
    pub commits: Option<Vec<Commit>>,
    pub refs: Option<Vec<Reference>>,
    pub has_more: bool,
    pub elapsed_ms: f64,
    pub watch_warning: Option<String>,
}
#[derive(Serialize)]
pub struct CommitDetails {
    pub message: String,
    pub paths: Vec<String>,
    pub parent: Option<String>,
    pub elapsed_ms: f64,
}
#[derive(Serialize)]
pub struct Versions {
    pub old: Option<String>,
    pub new: Option<String>,
    pub elapsed_ms: f64,
}

pub fn git(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("git");
    // Stash constructs its own pathspecs internally; literal mode prevents its
    // cleanup from removing the untracked files it has already saved.
    let pathspec_mode = if args.first() == Some(&"stash") {
        "--no-literal-pathspecs"
    } else {
        "--literal-pathspecs"
    };
    cmd.current_dir(root)
        .args(["--no-pager", pathspec_mode])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Could not run Git. Install Git and restart the app. {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().into());
    }
    if out.stdout.len() > 32 * 1024 * 1024 {
        return Err("This response exceeds the prototype's 32 MB limit.".into());
    }
    Ok(out.stdout)
}
pub fn git_text(root: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(git(root, args)?)
        .map_err(|_| "Non-UTF-8 Git output is not supported in this prototype.".into())
}
pub fn discover(path: &str) -> Result<PathBuf, String> {
    let root = git_text(Path::new(path), &["rev-parse", "--show-toplevel"])?;
    fs::canonicalize(root.trim_end_matches(['\n', '\r'])).map_err(|e| e.to_string())
}
fn names(bytes: Vec<u8>) -> Result<Vec<String>, String> {
    String::from_utf8(bytes)
        .map(|s| {
            s.split('\0')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        })
        .map_err(|_| "Non-UTF-8 filenames are not supported in this prototype.".into())
}
pub fn parse_status(bytes: Vec<u8>) -> Result<Vec<Change>, String> {
    let parts = names(bytes)?;
    let mut parts = parts.iter();
    let mut changes = vec![];
    while let Some(record) = parts.next() {
        if record.len() < 4 {
            continue;
        }
        let index = record.as_bytes()[0] as char;
        let worktree = record.as_bytes()[1] as char;
        let original_path = if [index, worktree].iter().any(|c| *c == 'R' || *c == 'C') {
            parts.next().cloned()
        } else {
            None
        };
        changes.push(Change {
            path: record[3..].into(),
            original_path,
            index,
            worktree,
        });
    }
    Ok(changes)
}
pub fn snapshot(root: &Path, limit: usize, history: bool) -> Result<Snapshot, String> {
    let start = Instant::now();
    let (status, paths, head, branch) = std::thread::scope(|s| {
        let status = s.spawn(|| {
            git(
                root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            )
        });
        let paths = s.spawn(|| {
            git(
                root,
                &[
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                ],
            )
        });
        let head = s.spawn(|| {
            git_text(root, &["rev-parse", "--verify", "HEAD"])
                .ok()
                .map(|s| s.trim().to_string())
        });
        let branch = s.spawn(|| {
            git_text(root, &["symbolic-ref", "--short", "HEAD"])
                .unwrap_or_else(|_| "Detached HEAD".into())
                .trim()
                .to_string()
        });
        Ok::<_, String>((
            status.join().map_err(|_| "Status worker failed")??,
            paths.join().map_err(|_| "File-list worker failed")??,
            head.join().map_err(|_| "HEAD worker failed")?,
            branch.join().map_err(|_| "Branch worker failed")?,
        ))
    })?;
    let changes = parse_status(status)?;
    let files = names(paths)?
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let mut commits = None;
    let mut refs = None;
    let mut has_more = false;
    if history {
        let raw = git_text(
            root,
            &[
                "for-each-ref",
                "--format=%(refname)%09%(objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        )?;
        refs = Some(
            raw.lines()
                .filter_map(|s| {
                    let (name, oid) = s.split_once('\t')?;
                    let (kind, name) = if let Some(s) = name.strip_prefix("refs/heads/") {
                        ("local", s)
                    } else if let Some(s) = name.strip_prefix("refs/remotes/") {
                        ("remote", s)
                    } else {
                        ("tag", name.trim_start_matches("refs/tags/"))
                    };
                    Some(Reference {
                        name: name.into(),
                        oid: oid.into(),
                        kind: kind.into(),
                    })
                })
                .collect(),
        );
        let mut list = vec![];
        let count = limit.saturating_add(1).to_string();
        let mut args = vec![
            "log",
            "--all",
            "--topo-order",
            "-z",
            "--format=%H%x00%P%x00%an%x00%at%x00%s",
            "-n",
            &count,
        ];
        if head.is_some() {
            args.push("HEAD");
        }
        let raw = git_text(root, &args)?;
        let fields: Vec<_> = raw.split('\0').collect();
        for f in fields.chunks(5) {
            if f.len() < 5 || f[0].is_empty() {
                continue;
            }
            list.push(Commit {
                oid: f[0].into(),
                parents: f[1].split_whitespace().map(String::from).collect(),
                author: f[2].into(),
                timestamp: f[3].parse().unwrap_or(0),
                subject: f[4].into(),
            });
        }
        has_more = list.len() > limit;
        list.truncate(limit);
        commits = Some(list);
    }
    Ok(Snapshot {
        root: root.to_string_lossy().into(),
        name: root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        branch,
        head,
        files,
        changes,
        commits,
        refs,
        has_more,
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.,
        watch_warning: None,
    })
}
fn validate_oid(oid: &str) -> Result<(), String> {
    if [40, 64].contains(&oid.len()) && oid.bytes().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid commit ID.".into())
    }
}
fn parent_for(root: &Path, oid: &str, parent: Option<&str>) -> Result<Option<String>, String> {
    validate_oid(oid)?;
    let parents = git_text(root, &["show", "-s", "--format=%P", oid])?;
    let list: Vec<_> = parents.split_whitespace().collect();
    match parent {
        Some(p) if list.contains(&p) => Ok(Some(p.into())),
        Some(_) => Err("Selected parent does not belong to this commit.".into()),
        None => Ok(list.first().map(|s| s.to_string())),
    }
}
pub fn details(root: &Path, oid: &str, parent: Option<&str>) -> Result<CommitDetails, String> {
    let start = Instant::now();
    let parent = parent_for(root, oid, parent)?;
    let message = git_text(root, &["show", "-s", "--format=%B", oid])?;
    let paths = if let Some(p) = &parent {
        names(git(
            root,
            &["diff", "--no-renames", "--name-only", "-z", p, oid, "--"],
        )?)?
    } else {
        names(git(
            root,
            &[
                "diff-tree",
                "--root",
                "--no-commit-id",
                "--no-renames",
                "--name-only",
                "-r",
                "-z",
                oid,
                "--",
            ],
        )?)?
    };
    Ok(CommitDetails {
        message,
        paths,
        parent,
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.,
    })
}
fn relative(path: &str) -> Result<&Path, String> {
    let path = Path::new(path);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || path.components().any(|c| c.as_os_str() == ".git")
    {
        return Err("Invalid repository-relative path.".into());
    }
    Ok(path)
}
fn safe_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = relative(path)?;
    let mut current = root.to_path_buf();
    for part in rel.components() {
        current.push(part);
        if let Ok(meta) = fs::symlink_metadata(&current) {
            if meta.file_type().is_symlink() {
                return Err("Symlinks are read-only in this prototype.".into());
            }
        }
    }
    Ok(current)
}
fn text_content(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() > MAX_FILE {
        return Err("File exceeds the prototype's 2 MB text limit.".into());
    }
    if bytes.contains(&0) {
        return Err("Binary file. Text preview is unavailable.".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "This file is not UTF-8. Editing is disabled to preserve its encoding.".into())
}
pub fn read_working(root: &Path, path: &str) -> Result<Option<String>, String> {
    let full = safe_path(root, path)?;
    let meta = match fs::metadata(&full) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.is_file() {
        return Err("This path is not a regular file.".into());
    }
    if meta.len() > MAX_FILE as u64 {
        return Err("File exceeds the prototype's 2 MB text limit.".into());
    }
    text_content(fs::read(full).map_err(|e| e.to_string())?).map(Some)
}
pub fn main_file_contents(root: &Path, path: &str) -> Result<Option<String>, String> {
    let oid = git_text(root, &["rev-parse", "--verify", "refs/heads/main^{commit}"])?;
    read_blob(root, oid.trim(), path)
}
fn read_blob(root: &Path, revision: &str, path: &str) -> Result<Option<String>, String> {
    relative(path)?;
    let spec = format!("{revision}:{path}");
    // Absence is normal for added/deleted files. Verify through the tree/index listing
    // rather than interpreting arbitrary Git failures as an empty file.
    let listed = if revision.is_empty() {
        git(root, &["ls-files", "--stage", "-z", "--", path])?
    } else {
        git(root, &["ls-tree", "-z", revision, "--", path])?
    };
    if listed.is_empty() {
        return Ok(None);
    }
    let size: usize = git_text(root, &["cat-file", "-s", &spec])?
        .trim()
        .parse()
        .map_err(|_| "Invalid blob size.")?;
    if size > MAX_FILE {
        return Err("File exceeds the prototype's 2 MB text limit.".into());
    }
    text_content(git(root, &["cat-file", "blob", &spec])?).map(Some)
}
pub fn versions(
    root: &Path,
    path: &str,
    source: &str,
    oid: Option<&str>,
    parent: Option<&str>,
    old_path: Option<&str>,
) -> Result<Versions, String> {
    let start = Instant::now();
    relative(path)?;
    let old_path = old_path.unwrap_or(path);
    let (old, new) = match source {
        "worktree" => (read_blob(root, "", path)?, read_working(root, path)?),
        "index" => {
            let old = if git(root, &["rev-parse", "--verify", "HEAD"]).is_ok() {
                read_blob(root, "HEAD", old_path)?
            } else {
                None
            };
            (old, read_blob(root, "", path)?)
        }
        "commit" => {
            let oid = oid.ok_or("Choose a commit first.")?;
            let parent = parent_for(root, oid, parent)?;
            let old = match parent {
                Some(p) => read_blob(root, &p, path)?,
                None => None,
            };
            (old, read_blob(root, oid, path)?)
        }
        _ => return Err("Unknown comparison type.".into()),
    };
    Ok(Versions {
        old,
        new,
        elapsed_ms: start.elapsed().as_secs_f64() * 1000.,
    })
}
pub fn save(root: &Path, path: &str, original: &str, contents: &str) -> Result<(), String> {
    if contents.len() > MAX_FILE {
        return Err("File exceeds the prototype's 2 MB text limit.".into());
    }
    let target = safe_path(root, path)?;
    if read_working(root, path)?.as_deref() != Some(original) {
        return Err(
            "File changed on disk. Your draft is preserved; reload or copy it before saving again."
                .into(),
        );
    }
    let parent = target.parent().ok_or("Invalid file path.")?;
    let temporary = parent.join(format!(
        ".githeaven-save-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::set_permissions(
            &temporary,
            fs::metadata(&target)
                .map_err(|e| e.to_string())?
                .permissions(),
        )
        .map_err(|e| e.to_string())?;
        if read_working(root, path)?.as_deref() != Some(original) {
            return Err("File changed while saving. Your draft is preserved.".into());
        }
        fs::rename(&temporary, &target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
pub fn stage(root: &Path, path: &str, unstage: bool) -> Result<(), String> {
    relative(path)?;
    let changes = parse_status(git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?)?;
    let change = changes
        .iter()
        .find(|c| c.path == path)
        .ok_or("File is no longer changed. Refresh and try again.")?;
    let mut paths = vec![path];
    if let Some(original) = change.original_path.as_deref() {
        paths.push(original);
    }
    let mut args = if !unstage {
        vec!["add", "-A", "--"]
    } else if git(root, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        vec!["reset", "-q", "HEAD", "--"]
    } else {
        vec!["rm", "--cached", "-f", "--"]
    };
    args.extend(paths);
    git(root, &args).map(|_| ())
}

pub fn stage_all(root: &Path, unstage: bool) -> Result<(), String> {
    if !unstage {
        git(root, &["add", "-A", "--", "."])?;
    } else if git(root, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        git(root, &["reset", "-q", "HEAD", "--", "."])?;
    } else {
        git(root, &["rm", "-r", "--cached", "-f", "--", "."])?;
    }
    Ok(())
}

#[cfg(test)]
pub fn checkout(root: &Path, name: &str, kind: &str) -> Result<(), String> {
    checkout_with_stash(root, name, kind, false)
}

pub fn checkout_with_stash(root: &Path, name: &str, kind: &str, stash: bool) -> Result<(), String> {
    let namespace = match kind {
        "local" => "heads",
        "remote" => "remotes",
        _ => return Err("Choose a local or remote branch to check out.".into()),
    };
    let full = format!("refs/{namespace}/{name}");
    git(root, &["check-ref-format", &full])?;
    git(root, &["show-ref", "--verify", &full])?;
    let local = if kind == "remote" {
        name.split_once('/').ok_or("Invalid remote branch.")?.1
    } else {
        name
    };
    git(root, &["check-ref-format", "--branch", local])?;
    let exists = git(
        root,
        &["show-ref", "--verify", &format!("refs/heads/{local}")],
    )
    .is_ok();
    if kind == "remote" && exists {
        let upstream = git_text(
            root,
            &[
                "for-each-ref",
                "--format=%(upstream)",
                &format!("refs/heads/{local}"),
            ],
        )?;
        if upstream.trim() != full {
            return Err(format!("Local branch {local} already exists and tracks a different branch. Choose it explicitly."));
        }
    }
    if git_text(root, &["branch", "--show-current"])?.trim() == local {
        return Ok(());
    }
    let dirty = !git_text(root, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty();
    if dirty && !stash {
        return Err("WIP_STASH_REQUIRED".into());
    }
    if dirty {
        git(
            root,
            &[
                "stash",
                "push",
                "--include-untracked",
                "-m",
                &format!("Githeaven: before switching to {name}"),
            ],
        )?;
        if !git_text(root, &["status", "--porcelain", "--untracked-files=normal"])?.is_empty() {
            return Err(
                "Some changes could not be stashed. Branch was not switched; your stash is saved."
                    .into(),
            );
        }
    }
    let result = if kind == "remote" && !exists {
        git(root, &["switch", "--track", "-c", local, "--", &full])
    } else {
        git(root, &["switch", "--no-guess", "--", local])
    };
    result.map(|_| ()).map_err(|error| {
        if dirty {
            format!("{error} Your changes remain saved in the Git stash.")
        } else {
            error
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        git(dir.path(), &["init", "-b", "main"]).unwrap();
        git(dir.path(), &["config", "user.name", "Test"]).unwrap();
        git(dir.path(), &["config", "user.email", "test@example.com"]).unwrap();
        dir
    }
    #[test]
    fn editor_baseline_uses_main_not_index_or_head() {
        let dir = repo();
        let r = dir.path();
        assert!(main_file_contents(r, "a.txt").is_err());
        fs::write(r.join("a.txt"), "main\n").unwrap();
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Base"]).unwrap();
        git(r, &["checkout", "-b", "feature"]).unwrap();
        fs::write(r.join("a.txt"), "feature\n").unwrap();
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Feature"]).unwrap();
        fs::write(r.join("a.txt"), "working\n").unwrap();
        assert_eq!(
            main_file_contents(r, "a.txt").unwrap(),
            Some("main\n".into())
        );
        assert_eq!(main_file_contents(r, "new.txt").unwrap(), None);
        assert!(main_file_contents(r, "../outside").is_err());
    }
    #[test]
    fn bulk_staging_preserves_files_and_handles_unborn_head() {
        let dir = repo();
        let r = dir.path();
        fs::write(r.join("a.txt"), "one\n").unwrap();
        fs::write(r.join("b.txt"), "two\n").unwrap();
        stage_all(r, false).unwrap();
        stage_all(r, true).unwrap();
        assert!(r.join("a.txt").exists());
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Initial"]).unwrap();
        fs::write(r.join("a.txt"), "changed\n").unwrap();
        fs::remove_file(r.join("b.txt")).unwrap();
        stage_all(r, false).unwrap();
        assert_eq!(
            git_text(r, &["diff", "--cached", "--name-only"])
                .unwrap()
                .lines()
                .count(),
            2
        );
        stage_all(r, true).unwrap();
        assert!(git_text(r, &["diff", "--cached", "--name-only"])
            .unwrap()
            .is_empty());
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "changed\n");
        assert!(!r.join("b.txt").exists());
    }
    #[test]
    fn checkout_local_and_remote_refuses_overwrite() {
        let dir = repo();
        let r = dir.path();
        fs::write(r.join("a.txt"), "base\n").unwrap();
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Base"]).unwrap();
        git(r, &["branch", "feature"]).unwrap();
        checkout(r, "feature", "local").unwrap();
        fs::write(r.join("a.txt"), "feature\n").unwrap();
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Feature"]).unwrap();
        checkout(r, "main", "local").unwrap();
        fs::write(r.join("a.txt"), "unsaved\n").unwrap();
        assert!(checkout(r, "feature", "local").is_err());
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "unsaved\n");
        fs::write(r.join("a.txt"), "base\n").unwrap();
        git(r, &["remote", "add", "origin", "."]).unwrap();
        git(
            r,
            &["update-ref", "refs/remotes/origin/new-feature", "feature"],
        )
        .unwrap();
        checkout(r, "origin/new-feature", "remote").unwrap();
        assert_eq!(
            git_text(r, &["branch", "--show-current"]).unwrap().trim(),
            "new-feature"
        );
        checkout(r, "origin/new-feature", "remote").unwrap();
        assert!(checkout(r, "--force", "local").is_err());
    }
    #[test]
    fn stash_checkout_requires_consent_and_preserves_index_and_untracked_files() {
        let dir = repo();
        let r = dir.path();
        fs::write(r.join("a.txt"), "base\n").unwrap();
        stage_all(r, false).unwrap();
        git(r, &["commit", "-m", "Base"]).unwrap();
        git(r, &["branch", "feature"]).unwrap();
        fs::write(r.join("a.txt"), "staged\n").unwrap();
        stage_all(r, false).unwrap();
        fs::write(r.join("a.txt"), "working\n").unwrap();
        fs::write(r.join("new.txt"), "untracked\n").unwrap();
        assert_eq!(
            checkout_with_stash(r, "feature", "local", false).unwrap_err(),
            "WIP_STASH_REQUIRED"
        );
        assert!(git_text(r, &["stash", "list"]).unwrap().is_empty());
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "working\n");
        checkout_with_stash(r, "feature", "local", true).unwrap();
        assert_eq!(
            git_text(r, &["branch", "--show-current"]).unwrap().trim(),
            "feature"
        );
        assert!(git_text(r, &["status", "--porcelain"]).unwrap().is_empty());
        assert!(!git_text(r, &["stash", "list"]).unwrap().is_empty());
        git(r, &["stash", "apply", "--index"]).unwrap();
        assert_eq!(fs::read_to_string(r.join("a.txt")).unwrap(), "working\n");
        assert_eq!(git_text(r, &["show", ":a.txt"]).unwrap(), "staged\n");
        assert_eq!(
            fs::read_to_string(r.join("new.txt")).unwrap(),
            "untracked\n"
        );
    }

    #[test]
    fn empty_repo_and_initial_commit() {
        let dir = repo();
        let r = dir.path();
        assert!(snapshot(r, 500, true).unwrap().commits.unwrap().is_empty());
        fs::write(r.join("a.txt"), "hello\n").unwrap();
        stage(r, "a.txt", false).unwrap();
        assert_eq!(
            versions(r, "a.txt", "index", None, None, None).unwrap().old,
            None
        );
        stage(r, "a.txt", true).unwrap();
        assert!(r.join("a.txt").exists());
        stage(r, "a.txt", false).unwrap();
        git(r, &["commit", "-m", "Initial"]).unwrap();
        let s = snapshot(r, 500, true).unwrap();
        let oid = &s.commits.unwrap()[0].oid;
        assert_eq!(details(r, oid, None).unwrap().paths, vec!["a.txt"]);
        assert_eq!(
            versions(r, "a.txt", "commit", Some(oid), None, None)
                .unwrap()
                .new
                .as_deref(),
            Some("hello\n")
        );
    }
    #[test]
    fn edit_stage_and_preserve_worktree() {
        let dir = repo();
        let r = dir.path();
        fs::write(r.join("odd\t name.txt"), "one\n").unwrap();
        stage(r, "odd\t name.txt", false).unwrap();
        git(r, &["commit", "-m", "First"]).unwrap();
        save(r, "odd\t name.txt", "one\n", "two\n").unwrap();
        let v = versions(r, "odd\t name.txt", "worktree", None, None, None).unwrap();
        assert_eq!(v.old.as_deref(), Some("one\n"));
        assert_eq!(v.new.as_deref(), Some("two\n"));
        stage(r, "odd\t name.txt", false).unwrap();
        stage(r, "odd\t name.txt", true).unwrap();
        assert_eq!(
            fs::read_to_string(r.join("odd\t name.txt")).unwrap(),
            "two\n"
        );
        assert!(save(r, "odd\t name.txt", "one\n", "bad\n").is_err());
    }
    #[test]
    fn parses_rename_and_untracked_without_losing_paths() {
        let c = parse_status(b"R  new name\0old name\0?? new\nfile\0".to_vec()).unwrap();
        assert_eq!(c[0].original_path.as_deref(), Some("old name"));
        assert_eq!(c[1].path, "new\nfile");
    }
    #[test]
    fn rejects_paths_outside_repo() {
        let dir = repo();
        assert!(safe_path(dir.path(), "../outside").is_err());
        assert!(safe_path(dir.path(), ".git/config").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/tmp", dir.path().join("link")).unwrap();
            assert!(safe_path(dir.path(), "link/file").is_err());
        }
    }
}
