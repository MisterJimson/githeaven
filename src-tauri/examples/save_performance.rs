//! Measures the actual save path using only a new disposable repository.
#[allow(dead_code)]
#[path = "../src/repository.rs"]
mod repository;
use std::{fs, time::Instant};

fn run() -> Result<(), String> {
    if std::env::args().len() != 1 {
        return Err("Usage: pnpm perf:save (no repository argument; always disposable)".into());
    }
    let directory = tempfile::Builder::new()
        .prefix("githeaven-save-performance-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let root = directory.path();
    repository::git(root, &["init", "-q"])?;
    eprintln!("Production save benchmark: {} {}, release={}, Git={}; 3 warmups and 20 measured saves per size. Fresh temporary repository, warm filesystem caches; excludes IPC/UI/watchers.",
        std::env::consts::OS, std::env::consts::ARCH, !cfg!(debug_assertions),
        repository::git_text(root, &["--version"])?.trim());
    println!("operation,bytes,iteration,milliseconds");
    for bytes in [1024, 100 * 1024, 1024 * 1024, 2 * 1024 * 1024] {
        let name = "sample.txt";
        let mut current = "a".repeat(bytes);
        fs::write(root.join(name), &current).map_err(|e| e.to_string())?;
        for iteration in 0..23 {
            let next = if current.starts_with('a') { "b" } else { "a" }.repeat(bytes);
            let start = Instant::now();
            repository::save(root, name, &current, &next)?;
            let elapsed = start.elapsed().as_secs_f64() * 1000.;
            // Validate after the clock stops, including conflict-preservation
            // behavior separately below. Never weaken fsync or conflict checks.
            if repository::read_working(root, name)?.as_deref() != Some(next.as_str()) {
                return Err("Saved contents did not match.".into());
            }
            current = next;
            if iteration >= 3 {
                println!("save,{bytes},{},{elapsed:.6}", iteration - 3);
            }
        }
        if repository::save(root, name, "stale contents", "replacement").is_ok() {
            return Err("Conflicting save unexpectedly succeeded.".into());
        }
        if repository::read_working(root, name)?.as_deref() != Some(current.as_str()) {
            return Err("Conflicting save changed the file.".into());
        }
        if fs::read_dir(root).map_err(|e| e.to_string())?.any(|entry| {
            entry.is_ok_and(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".githeaven-save-")
            })
        }) {
            return Err("Save left a temporary file behind.".into());
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
