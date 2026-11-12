use serde::Serialize;
use std::io::ErrorKind;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Why a CLI invocation produced no output. `Missing` means the binary is not on
/// PATH (optional tooling); `Failed` means it ran and exited non-zero.
enum RunError {
    Missing,
    Failed(String),
}

impl RunError {
    fn message(self) -> String {
        match self {
            RunError::Missing => "binary not found on PATH".to_string(),
            RunError::Failed(e) => e,
        }
    }
}

/// FINDER GAP: an .app started by Finder or Spotlight inherits launchd's PATH
/// (`/usr/bin:/bin:/usr/sbin:/sbin`), so every Homebrew CLI reads as missing and the
/// whole Docker surface gates itself off. Put the usual install roots first, once,
/// before Tauri spawns any worker thread.
pub(crate) fn ensure_toolchain_path() {
    const ROOTS: [&str; 5] = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/opt/local/bin", "/usr/bin"];
    let mut dirs: Vec<PathBuf> = ROOTS.iter().map(PathBuf::from).collect();
    for dir in std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()) {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    if let Ok(joined) = std::env::join_paths(dirs) {
        // SAFETY: called from `run()` before any thread exists.
        unsafe { std::env::set_var("PATH", joined) };
    }
}

fn run(bin: &str, args: &[&str]) -> Result<String, RunError> {
    let out = Command::new(bin).args(args).output().map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            RunError::Missing
        } else {
            RunError::Failed(format!("failed to spawn {bin}: {e}"))
        }
    })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(RunError::Failed(String::from_utf8_lossy(&out.stderr).to_string()))
    }
}

/// PATH lookup without spawning `which`. A refresh probes nine binaries, and every
/// spawn costs a process; one stat per PATH entry is free by comparison.
pub(crate) fn which_bin(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| executable(candidate))
}

fn executable(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    meta.is_file() && meta.permissions().mode() & 0o111 != 0
}

fn installed(bin: &str) -> bool {
    which_bin(bin).is_some()
}

#[derive(Serialize, Default)]
pub struct SystemStatus {
    pub colima: bool,
    pub docker: bool,
    pub kubectl: bool,
    pub lima: bool,
    pub kind: bool,
    pub nerdctl: bool,
    pub compose: bool,
    pub ramalama: bool,
    pub krunkit: bool,
}

pub fn system_status() -> SystemStatus {
    let docker = installed("docker");
    SystemStatus {
        colima: installed("colima"),
        docker,
        kubectl: installed("kubectl"),
        lima: installed("limactl"),
        kind: installed("kind"),
        nerdctl: installed("nerdctl"),
        compose: docker && run("docker", &["compose", "version"]).is_ok(),
        ramalama: installed("ramalama"),
        krunkit: installed("krunkit"),
    }
}

#[derive(Serialize)]
pub struct ComposeProject {
    pub name: String,
    pub status: String,
}

#[derive(serde::Deserialize)]
struct RawCompose {
    #[serde(alias = "Name")]
    name: Option<String>,
    #[serde(alias = "Status")]
    status: Option<String>,
}

/// Empty when the compose plugin is absent; a real `docker compose` failure is
/// surfaced because it usually means a broken Docker install.
pub fn compose_list() -> Result<Vec<ComposeProject>, String> {
    let raw = match run("docker", &["compose", "ls", "--all", "--format", "json"]) {
        Ok(raw) => raw,
        Err(RunError::Missing) => return Ok(Vec::new()),
        Err(e) => return Err(e.message()),
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Vec<RawCompose> = serde_json::from_str(trimmed)
        .map_err(|e| format!("failed to parse docker compose ls: {e}"))?;
    Ok(parsed
        .into_iter()
        .filter_map(|p| {
            let name = p.name?;
            Some(ComposeProject { name, status: p.status.unwrap_or_default() })
        })
        .collect())
}

/// Optional tool: any failure (missing binary, non-zero exit) means "no clusters".
pub fn kind_clusters() -> Vec<String> {
    match run("kind", &["get", "clusters"]) {
        Ok(raw) => raw
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string)
            .collect(),
        Err(_) => Vec::new(),
    }
}

#[derive(Serialize)]
pub struct LimaVm {
    pub name: String,
    pub status: String,
}

#[derive(serde::Deserialize)]
struct RawLima {
    name: Option<String>,
    status: Option<String>,
}

/// Optional tool: a missing `limactl` is a normal state, not an error.
pub fn lima_vms() -> Vec<LimaVm> {
    let raw = match run("limactl", &["list", "--json"]) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    raw.lines()
        .filter_map(|line| {
            let t = line.trim();
            if t.is_empty() {
                return None;
            }
            let v = serde_json::from_str::<RawLima>(t).ok()?;
            Some(LimaVm { name: v.name?, status: v.status.unwrap_or_default() })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Optional tooling must never reject: absent binaries return empty lists so the
    /// dashboard does not raise an error banner on every refresh.
    #[test]
    fn optional_tools_never_error() {
        assert!(compose_list().is_ok());
        let _ = kind_clusters();
        let _ = lima_vms();
    }

    #[test]
    fn system_status_reports_missing_kind_as_false() {
        let status = system_status();
        assert_eq!(status.kind, installed("kind"));
        assert_eq!(status.lima, installed("limactl"));
    }

    /// Finder launches the app with launchd's four-directory PATH; the Homebrew roots
    /// must be added back or every gated surface disappears.
    #[test]
    fn toolchain_path_recovers_from_a_finder_launch() {
        // SAFETY: the only test that touches the process env.
        unsafe { std::env::set_var("PATH", "/usr/bin:/bin:/usr/sbin:/sbin") };
        ensure_toolchain_path();
        let path = std::env::var("PATH").unwrap();
        assert!(path.starts_with("/opt/homebrew/bin:"), "{path}");
        assert!(path.ends_with("/usr/bin:/bin:/usr/sbin:/sbin"), "{path}");
        assert!(which_bin("sh").is_some(), "shell must still resolve");
    }
}
