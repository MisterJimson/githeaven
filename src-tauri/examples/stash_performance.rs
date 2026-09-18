//! Read-only selection benchmark. Usage: cargo run --release --example stash_performance -- /repo
#[allow(dead_code)]
#[path = "../src/repository.rs"]
mod repository;
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), String> {
    let root = PathBuf::from(std::env::args().nth(1).ok_or("Pass a repository path")?);
    let stashes = repository::stashes(&root)?;
    let stash = stashes.first().ok_or("No stashes")?;
    for iteration in 0..12 {
        for is_stash in [false, true] {
            let start = Instant::now();
            let details = if is_stash {
                repository::stash_details(&root, &stash.oid)?
            } else {
                repository::details(&root, &stash.base, None)?
            };
            println!(
                "{},{iteration},{:.3},{}",
                if is_stash {
                    "stash.details"
                } else {
                    "commit.details"
                },
                start.elapsed().as_secs_f64() * 1000.,
                details.paths.len()
            );
        }
    }
    Ok(())
}
