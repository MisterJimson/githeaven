//! Read-only benchmark using the app's actual repository implementation.
#[allow(dead_code)]
#[path = "../src/repository.rs"]
mod repository;
use std::{path::Path, time::Instant};

fn measure(name: &str, mut work: impl FnMut() -> Result<usize, String>) -> Result<(), String> {
    // Keep first-call evidence separate; this is not an OS cold-cache guarantee.
    for iteration in 0..16 {
        let start = Instant::now();
        let bytes = work()?;
        println!(
            "{name},{iteration},{:.3},{bytes}",
            start.elapsed().as_secs_f64() * 1000.
        );
    }
    Ok(())
}
fn run(root: &Path) -> Result<(), String> {
    println!("operation,iteration,milliseconds,output_units");
    for (label, limit, history) in [
        ("snapshot.working", 500, false),
        ("snapshot.500", 500, true),
        ("snapshot.2000", 2000, true),
        ("snapshot.6000", 6000, true),
    ] {
        measure(label, || {
            let snapshot = repository::snapshot(root, limit, history)?;
            Ok(snapshot.files.len())
        })?;
    }
    for (name, args) in [
        (
            "git.status",
            vec!["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        ),
        (
            "git.files",
            vec![
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ],
        ),
        (
            "git.refs",
            vec![
                "for-each-ref",
                "--format=%(refname)%09%(objectname)",
                "refs/heads",
                "refs/remotes",
                "refs/tags",
            ],
        ),
        ("git.head", vec!["rev-parse", "--verify", "HEAD"]),
    ] {
        measure(name, || repository::git(root, &args).map(|data| data.len()))?;
    }
    let snapshot = repository::snapshot(root, 500, true)?;
    measure("serialize.snapshot", || {
        serde_json::to_vec(&snapshot)
            .map(|data| data.len())
            .map_err(|e| e.to_string())
    })?;
    if let Some(head) = &snapshot.head {
        measure("commit.details", || {
            repository::details(root, head, None).map(|details| details.paths.len())
        })?;
    }
    // Only inspect a small regular text file; never print its name or contents.
    if let Some(path) = snapshot.files.iter().find(|path| {
        (path.ends_with(".ts") || path.ends_with(".rs") || path.ends_with(".md"))
            && std::fs::symlink_metadata(root.join(path))
                .is_ok_and(|meta| meta.is_file() && meta.len() < 256 * 1024)
    }) {
        measure("file.read", || {
            repository::read_working(root, path).map(|data| data.map_or(0, |s| s.len()))
        })?;
        measure("file.versions", || {
            repository::versions(root, path, "worktree", None, None, None)
                .map(|v| v.old.map_or(0, |s| s.len()) + v.new.map_or(0, |s| s.len()))
        })?;
    }
    Ok(())
}
fn main() {
    eprintln!(
        "Native backend benchmark: {} {}, release={}, first sample separate from 15 warm samples",
        std::env::consts::OS,
        std::env::consts::ARCH,
        !cfg!(debug_assertions)
    );
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("Usage: performance <repository>");
        std::process::exit(2);
    };
    let result = repository::discover(&path).and_then(|root| run(&root));
    if let Err(error) = result {
        eprintln!("Benchmark failed: {error}");
        std::process::exit(1);
    }
}
