use crate::{avatars::github_repo, repository::git_text};
use serde::Serialize;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct PullRequest {
    number: u64,
    url: String,
}
fn parse_url(url: &str) -> Option<PullRequest> {
    let (repo, number) = url.split_once("/pull/")?;
    let repo = github_repo(repo)?;
    if !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let number: u64 = number.parse().ok()?;
    if number == 0 {
        return None;
    }
    Some(PullRequest {
        number,
        url: format!("https://github.com/{repo}/pull/{number}"),
    })
}
pub fn lookup(root: &Path, oid: &str) -> Result<Vec<PullRequest>, String> {
    if ![40, 64].contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid commit ID".into());
    }
    let remote = git_text(root, &["remote", "get-url", "origin"]).unwrap_or_default();
    let Some(repo) = github_repo(&remote) else {
        return Ok(vec![]);
    };
    let executable = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
        .into_iter()
        .find(|p| Path::new(p).is_file())
        .unwrap_or("gh");
    let Ok(mut child) = Command::new(executable)
        .args([
            "api",
            "--hostname",
            "github.com",
            &format!("repos/{repo}/commits/{oid}/pulls?per_page=100"),
            "--jq",
            "[.[] | select(.state == \"open\") | .html_url] | .[:10][]",
        ])
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return Ok(vec![]);
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if start.elapsed() < Duration::from_secs(8) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(vec![]);
            }
        }
    }
    let mut output = String::new();
    if let Some(stdout) = child.stdout.take() {
        let _ = stdout.take(4096).read_to_string(&mut output);
    }
    Ok(output.lines().filter_map(parse_url).collect())
}
pub fn open(url: &str) -> Result<(), String> {
    let pr = parse_url(url).ok_or("Invalid GitHub pull request URL")?;
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = Command::new("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    let status = command.arg(pr.url).status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open the browser.".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_opens_github_pull_request_urls() {
        assert_eq!(
            parse_url("https://github.com/owner/repo/pull/42")
                .unwrap()
                .number,
            42
        );
        for url in [
            "https://evil.com/o/r/pull/1",
            "https://github.com.evil/o/r/pull/1",
            "https://github.com/o/r/pull/0",
            "https://github.com/o/r/pull/1?x=y",
            "https://github.com/o/r/pull/1/../../settings",
        ] {
            assert!(parse_url(url).is_none());
        }
    }
}
