use crate::repository::git_text;
use serde::Serialize;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[derive(Serialize)]
pub struct Avatar {
    login: String,
    url: String,
}
fn github_repo(remote: &str) -> Option<String> {
    let path = remote
        .trim()
        .strip_prefix("git@github.com:")
        .or_else(|| remote.trim().strip_prefix("https://github.com/"))
        .or_else(|| remote.trim().strip_prefix("ssh://git@github.com/"))?;
    let path = path
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_end_matches('/'));
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || !p
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
    {
        return None;
    }
    Some(path.into())
}
// Optional GitHub CLI integration reuses the user's existing authentication.
// No credentials or author emails are sent to a separate identity service.
pub fn lookup(root: &Path, oid: &str) -> Result<Option<Avatar>, String> {
    if ![40, 64].contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid commit ID".into());
    }
    let remote = git_text(root, &["remote", "get-url", "origin"]).unwrap_or_default();
    let Some(repo) = github_repo(&remote) else {
        return Ok(None);
    };
    let executable = ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
        .into_iter()
        .find(|p| Path::new(p).is_file())
        .unwrap_or("gh");
    let Ok(mut child) = Command::new(executable).args(["api", "--hostname", "github.com", &format!("repos/{repo}/commits/{oid}"), "--jq", "if .author == null then empty else [.author.login, (.author.id | tostring)] | @tsv end"])
        .env("GH_PROMPT_DISABLED", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() else { return Ok(None); };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Ok(None);
                }
                break;
            }
            Ok(None) if start.elapsed() < Duration::from_secs(8) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
        }
    }
    let mut output = String::new();
    if let Some(stdout) = child.stdout.take() {
        let _ = stdout.take(1024).read_to_string(&mut output);
    }
    let Some((login, id)) = output.trim().split_once('\t') else {
        return Ok(None);
    };
    if login.is_empty()
        || !login
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-[]".contains(&b))
        || id.is_empty()
        || !id.bytes().all(|b| b.is_ascii_digit())
    {
        return Ok(None);
    }
    Ok(Some(Avatar {
        login: login.into(),
        url: format!("https://avatars.githubusercontent.com/u/{id}?s=48&v=4"),
    }))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restricts_lookup_to_exact_github_remotes() {
        assert_eq!(
            github_repo("git@github.com:owner/repo.git"),
            Some("owner/repo".into())
        );
        assert_eq!(
            github_repo("https://github.com/owner/repo"),
            Some("owner/repo".into())
        );
        assert_eq!(
            github_repo("ssh://git@github.com/owner/repo.git"),
            Some("owner/repo".into())
        );
        for invalid in [
            "https://github.com.evil/owner/repo",
            "https://gitlab.com/owner/repo",
            "https://github.com/../repo",
            "https://github.com/owner/repo?x=y",
        ] {
            assert!(github_repo(invalid).is_none());
        }
    }
}
