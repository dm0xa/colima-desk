use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};

fn colima_bin() -> String {
    crate::tools::which_bin("colima")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/opt/homebrew/bin/colima".to_string())
}

/// Colima prints logrus records on failure (`time="…" level=fatal msg="…"`).
/// Keep only the message and turn its escaped newlines into real ones.
fn humanize(raw: &str) -> String {
    let raw = raw.trim();
    if let Some(pos) = raw.find("msg=\"") {
        let mut out = String::new();
        let mut chars = raw[pos + 5..].chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => match chars.next() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some(other) => out.push(other),
                    None => break,
                },
                '"' => break,
                other => out.push(other),
            }
        }
        if !out.trim().is_empty() {
            return out.trim().to_string();
        }
    }
    raw.to_string()
}

pub fn run(args: &[&str]) -> Result<String, String> {
    let out = Command::new(colima_bin())
        .args(args)
        .output()
        .map_err(|e| format!("failed to spawn colima: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(humanize(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// One `colima ssh -- sh -c` round trip for a read-only report. A stopped profile or a
/// denied sudo returns Colima's message instead of blocking the caller.
pub fn ssh_script(profile: &str, script: &str) -> Result<String, String> {
    let out = Command::new(colima_bin())
        .args(["ssh", "-p", profile, "--", "sh", "-c", script])
        .output()
        .map_err(|e| format!("failed to spawn colima: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(humanize(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// Lima instance name for a Colima profile: the default profile is the "colima" instance.
fn instance_name(profile: &str) -> &str {
    if profile == "default" { "colima" } else { profile }
}

/// The profile's disk image on the host: path plus the bytes it actually occupies.
/// The image is sparse, so `len()` overstates it; allocated blocks are what Finder charges.
pub fn disk_image(profile: &str) -> (String, u64) {
    let home = std::env::var("HOME").unwrap_or_default();
    let instance = instance_name(profile);
    let candidates = [
        format!("{home}/.colima/_lima/{instance}/disk"),
        format!("{home}/.lima/{instance}/disk"),
    ];
    for path in candidates {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        #[cfg(unix)]
        let bytes = {
            use std::os::unix::fs::MetadataExt;
            meta.blocks() * 512
        };
        #[cfg(not(unix))]
        let bytes = meta.len();
        if bytes > 0 {
            return (path, bytes);
        }
    }
    (String::new(), 0)
}

#[derive(Deserialize, Clone, serde::Serialize)]
pub struct Profile {
    pub name: String,
    pub status: String,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default)]
    pub cpus: Option<u32>,
    #[serde(default)]
    pub memory: Option<u64>,
    #[serde(default)]
    pub disk: Option<u64>,
    #[serde(default)]
    pub runtime: Option<String>,
}

pub fn list_profiles() -> Result<Vec<Profile>, String> {
    let raw = run(&["list", "--json"])?;
    let mut out = Vec::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.is_empty() { continue; }
        if let Ok(p) = serde_json::from_str::<Profile>(t) {
            out.push(p);
        }
    }
    if out.is_empty() {
        if let Ok(v) = serde_json::from_str::<Vec<Profile>>(raw.trim()) {
            return Ok(v);
        }
        return Err("no profiles parsed".to_string());
    }
    Ok(out)
}

#[derive(Deserialize, Clone, serde::Serialize)]
pub struct Status {
    pub display_name: Option<String>,
    pub driver: Option<String>,
    pub arch: Option<String>,
    pub runtime: Option<String>,
    pub mount_type: Option<String>,
    pub docker_socket: Option<String>,
    pub containerd_socket: Option<String>,
    pub kubernetes: Option<bool>,
    pub cpu: Option<u32>,
    pub memory: Option<u64>,
    pub disk: Option<u64>,
}

pub fn status(profile: &str) -> Result<Status, String> {
    let raw = if profile == "default" {
        run(&["status", "--json"])?
    } else {
        run(&["status", "--json", "-p", profile])?
    };
    let mut json = String::new();
    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with('{') { json = t.to_string(); break; }
    }
    if json.is_empty() { json = raw.trim().to_string(); }
    serde_json::from_str(&json).map_err(|e| format!("parse status: {e}"))
}

pub fn version() -> String {
    run(&["version"]).unwrap_or_else(|e| e)
}

/// Docker endpoint for a profile. Falls back to the conventional socket path when
/// the profile is stopped, so commands fail against the right socket instead of
/// silently reusing another profile's daemon. Callers that already ran `status`
/// pass it in; that command costs ~700 ms, so it must never run twice in one switch.
pub fn docker_endpoint(profile: &str, status: Option<&Status>) -> String {
    if let Some(socket) = status.and_then(|st| st.docker_socket.clone()) {
        if !socket.is_empty() {
            return socket;
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = if profile == "default" { "default".to_string() } else { profile.to_string() };
    format!("unix://{home}/.colima/{dir}/docker.sock")
}

pub fn template() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = format!("{home}/.colima/_templates/default.yaml");
    std::fs::read_to_string(&path).map_err(|e| format!("read template: {e}"))
}

pub fn ssh_config(profile: &str) -> Result<String, String> {
    if profile == "default" { run(&["ssh-config"]) } else { run(&["ssh-config", "-p", profile]) }
}


#[derive(Deserialize, Clone, serde::Serialize)]
pub struct ProfileConfig {
    pub vm_type: String,
    pub runtime: String,
    pub arch: String,
    pub mount_type: String,
    pub cpu: u32,
    pub memory: u32,
    pub disk: u32,
    pub rosetta: bool,
}

pub fn profile_config(profile: &str) -> Result<ProfileConfig, String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let path = format!("{home}/.colima/{profile}/colima.yaml");
    let text = std::fs::read_to_string(&path).map_err(|e| format!("read config: {e}"))?;
    let mut cfg = ProfileConfig { vm_type: "vz".into(), runtime: "docker".into(), arch: "aarch64".into(), mount_type: "virtiofs".into(), cpu: 2, memory: 2, disk: 60, rosetta: false };
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || !line.contains(':') { continue; }
        let (k, v) = line.split_once(':').unwrap();
        let v = v.trim().trim_matches('"');
        match k.trim() {
            "vmType" => cfg.vm_type = v.to_string(),
            "runtime" => cfg.runtime = v.to_string(),
            "arch" => cfg.arch = v.to_string(),
            "mountType" => cfg.mount_type = v.to_string(),
            "cpu" => cfg.cpu = v.parse().unwrap_or(cfg.cpu),
            "memory" => cfg.memory = v.parse().unwrap_or(cfg.memory),
            "disk" => cfg.disk = v.parse().unwrap_or(cfg.disk),
            "rosetta" => cfg.rosetta = v == "true",
            _ => {}
        }
    }
    Ok(cfg)
}

pub fn model_list(profile: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["model", "list"];
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}

pub fn model_pull(profile: &str, model: &str, runner: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["model", "pull", model];
    if !runner.is_empty() && runner != "docker" { a.push("--runner"); a.push(runner); }
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}

pub fn model_setup(profile: &str, runner: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["model", "setup"];
    if !runner.is_empty() && runner != "docker" { a.push("--runner"); a.push(runner); }
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}

/// Opens an interactive chat session in Terminal.app (GUI cannot host a TTY).
pub fn model_run_terminal(profile: &str, model: &str, runner: &str) -> Result<String, String> {
    let mut cmd = format!("colima model run {model}");
    if !runner.is_empty() && runner != "docker" { cmd.push_str(&format!(" --runner {runner}")); }
    if profile != "default" { cmd.push_str(&format!(" -p {profile}")); }
    let script = cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let out = Command::new("osascript")
        .args(["-e", &format!("tell application \"Terminal\" to do script \"{script}\""), "-e", "tell application \"Terminal\" to activate"])
        .output()
        .map_err(|e| format!("open Terminal: {e}"))?;
    if out.status.success() { Ok(format!("Opened: {cmd}")) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

pub fn model_serve_start(profile: &str, model: &str, runner: &str, port: u32) -> Result<u32, String> {
    let mut a: Vec<String> = vec!["model".into(), "serve".into(), model.into()];
    if !runner.is_empty() && runner != "docker" { a.push("--runner".into()); a.push(runner.into()); }
    if port > 0 { a.push("--port".into()); a.push(port.to_string()); }
    if profile != "default" { a.push("-p".into()); a.push(profile.into()); }
    let child = Command::new(colima_bin())
        .args(&a)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn serve: {e}"))?;
    Ok(child.id())
}

pub fn model_serve_stop(pid: u32) -> Result<String, String> {
    let out = Command::new("kill").arg("-TERM").arg(pid.to_string()).output().map_err(|e| e.to_string())?;
    if out.status.success() { Ok("Stopped model server".into()) } else { Err(String::from_utf8_lossy(&out.stderr).to_string()) }
}

#[derive(Deserialize, Clone, serde::Serialize)]
pub struct StartOpts {
    pub profile: String,
    pub cpus: Option<u32>,
    pub memory: Option<u64>,
    pub disk: Option<u64>,
    pub runtime: Option<String>,
    pub arch: Option<String>,
    pub vm_type: Option<String>,
    pub kubernetes: Option<bool>,
    pub rosetta: Option<bool>,
    pub mount: Option<String>,
    pub hostname: Option<String>,
}

/// `--vz-rosetta` is registered whatever `--vm-type` says, but only a vz VM runs it, so
/// sending it with qemu or krunkit would let the UI promise amd64 emulation that never runs.
pub fn rosetta_applies(vm_type: Option<&str>) -> bool {
    matches!(vm_type, None | Some("vz"))
}

pub fn start(o: &StartOpts) -> Result<String, String> {
    let mut a: Vec<String> = vec!["start".into()];
    if o.profile != "default" { a.push(o.profile.clone()); }
    if let Some(v) = o.cpus { a.push("--cpus".into()); a.push(v.to_string()); }
    if let Some(v) = o.memory { a.push("--memory".into()); a.push(v.to_string()); }
    if let Some(v) = o.disk { a.push("--disk".into()); a.push(v.to_string()); }
    if let Some(v) = &o.runtime { a.push("--runtime".into()); a.push(v.clone()); }
    if let Some(v) = &o.arch { a.push("--arch".into()); a.push(v.clone()); }
    if let Some(v) = &o.vm_type { a.push("--vm-type".into()); a.push(v.clone()); }
    if o.kubernetes == Some(true) { a.push("--kubernetes".into()); }
    if o.rosetta == Some(true) && rosetta_applies(o.vm_type.as_deref()) { a.push("--vz-rosetta".into()); }
    if let Some(v) = &o.mount { if !v.trim().is_empty() { a.push("--mount".into()); a.push(v.clone()); } }
    if let Some(v) = &o.hostname { if !v.trim().is_empty() { a.push("--hostname".into()); a.push(v.clone()); } }
    let r: Vec<&str> = a.iter().map(|s| s.as_str()).collect();
    run(&r)
}

pub fn stop(profile: &str) -> Result<String, String> {
    let a: Vec<&str> = if profile == "default" { vec!["stop"] } else { vec!["stop", profile] };
    run(&a)
}

pub fn restart(profile: &str) -> Result<String, String> {
    let a: Vec<&str> = if profile == "default" { vec!["restart"] } else { vec!["restart", profile] };
    run(&a)
}

pub fn delete(profile: &str, data: bool, force: bool) -> Result<String, String> {
    let mut a: Vec<String> = vec!["delete".into()];
    if profile != "default" { a.push(profile.into()); }
    if data { a.push("--data".into()); }
    if force { a.push("--force".into()); }
    let r: Vec<&str> = a.iter().map(|s| s.as_str()).collect();
    run(&r)
}

pub fn kubernetes(profile: &str, action: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["kubernetes", action];
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}

pub fn model_run(profile: &str, model: &str, prompt: &str, runner: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["model", "run", model];
    if !prompt.trim().is_empty() { a.push(prompt); }
    if !runner.is_empty() && runner != "docker" { a.push("--runner"); a.push(runner); }
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}

/// Serve starts a blocking web server; launch detached and return immediately.
pub fn model_serve(profile: &str, model: &str, runner: &str, port: u32) -> Result<String, String> {
    let mut a: Vec<String> = vec!["model".into(), "serve".into(), model.into()];
    if !runner.is_empty() && runner != "docker" { a.push("--runner".into()); a.push(runner.into()); }
    if port > 0 { a.push("--port".into()); a.push(port.to_string()); }
    if profile != "default" { a.push("-p".into()); a.push(profile.into()); }
    Command::new(colima_bin())
        .args(&a)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("spawn serve: {e}"))?;
    Ok(format!("Started colima model serve {model}"))
}

pub fn prune(profile: &str) -> Result<String, String> {
    let a: Vec<&str> = if profile == "default" { vec!["prune"] } else { vec!["prune", "-p", profile] };
    run(&a)
}

/// `colima update` updates the container runtime *inside* the VM. It is not a
/// CLI upgrade — this only ever touches the guest. Without `-p` it targets the
/// default profile whatever profile the UI has selected, so always pass it.
pub fn update(profile: &str) -> Result<String, String> {
    let a: Vec<&str> = if profile == "default" { vec!["update"] } else { vec!["update", "-p", profile] };
    run(&a)
}

#[derive(Serialize, Default)]
pub struct VersionInfo {
    pub installed: String,
    /// Newest published GitHub release, None when the check could not run.
    pub latest: Option<String>,
    /// "brew" or "manual" — decides whether the app can upgrade the CLI itself.
    pub manager: String,
    pub update_available: bool,
}

/// "colima version 0.10.3\ngit commit: …" -> "0.10.3"
fn version_from(raw: &str) -> Option<String> {
    let token = raw.lines().next()?.split_whitespace().last()?;
    token.chars().next().filter(|c| c.is_ascii_digit())?;
    Some(token.to_string())
}

/// "v0.10.10" -> (0, 10, 10). Pre-release and build suffixes are ignored.
fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let core = raw.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next().unwrap_or("0").parse().ok()?;
    Some((major, minor, patch))
}

/// Homebrew installs live under a Cellar directory; anything else was installed by hand.
fn manager() -> &'static str {
    match std::fs::canonicalize(colima_bin()) {
        Ok(path) if path.to_string_lossy().contains("/Cellar/") => "brew",
        _ => "manual",
    }
}

fn latest_release(repo: &str) -> Option<String> {
    let out = Command::new("curl")
        .args([
            "-fsSL", "--max-time", "6",
            "-H", "Accept: application/vnd.github+json",
            &format!("https://api.github.com/repos/{repo}/releases/latest"),
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let tag = json.get("tag_name")?.as_str()?.trim_start_matches('v').to_string();
    parse_version(&tag).map(|_| tag)
}

/// `latest` is a published release the running build predates. A missing tag (offline,
/// rate-limited, malformed) is never an available update.
fn is_newer(latest: Option<&str>, installed: &str) -> bool {
    match (parse_version(installed), latest.and_then(parse_version)) {
        (Some(installed), Some(latest)) => latest > installed,
        _ => false,
    }
}

pub fn version_check() -> VersionInfo {
    let installed = version_from(&version()).unwrap_or_default();
    let latest = latest_release("abiosoft/colima");
    let update_available = is_newer(latest.as_deref(), &installed);
    VersionInfo { installed, latest, manager: manager().to_string(), update_available }
}

/// This app's own release channel, so About can say a newer build exists without
/// embedding a second version string: the installed side is the crate version, which
/// `package.json` and `tauri.conf.json` already carry in lockstep.
#[derive(Serialize, Default)]
pub struct AppReleaseInfo {
    pub installed: String,
    /// Newest published GitHub release, None when the check could not run.
    pub latest: Option<String>,
    pub update_available: bool,
    /// Release page for the newest tag; the frontend opens it with the guarded opener.
    pub url: String,
}

const APP_REPO: &str = "dm0xa/colima-desk";

pub fn app_release_check() -> AppReleaseInfo {
    let installed = env!("CARGO_PKG_VERSION").to_string();
    let latest = latest_release(APP_REPO);
    let update_available = is_newer(latest.as_deref(), &installed);
    AppReleaseInfo {
        installed,
        latest,
        update_available,
        url: format!("https://github.com/{APP_REPO}/releases/latest"),
    }
}

/// Upgrades the CLI itself. Only Homebrew installs can be upgraded in place.
pub fn upgrade() -> Result<String, String> {
    if manager() != "brew" {
        return Err("Colima was installed without Homebrew. Download the latest release from github.com/abiosoft/colima/releases.".to_string());
    }
    let brew = crate::tools::which_bin("brew")
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/opt/homebrew/bin/brew".to_string());
    let out = Command::new(brew)
        .args(["upgrade", "colima"])
        .output()
        .map_err(|e| format!("failed to spawn brew: {e}"))?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if out.status.success() {
        Ok(text.trim().to_string())
    } else {
        Err(text.trim().to_string())
    }
}

/// Everything the guest can report about its own health. Sizes are bytes, from kB
/// in /proc and df, so the UI never has to know the guest's units.
#[derive(Serialize, Default)]
pub struct VmDiagnostics {
    pub ok: bool,
    pub error: Option<String>,
    pub kernel: String,
    pub uptime_seconds: u64,
    pub cpus: u32,
    pub load1: f64,
    pub load5: f64,
    pub load15: f64,
    pub mem_total: u64,
    pub mem_available: u64,
    pub swap_total: u64,
    pub swap_free: u64,
    pub root_total: u64,
    pub root_used: u64,
    pub inodes_total: u64,
    pub inodes_used: u64,
    pub docker_active: bool,
    /// Number of "Killed process" lines in the last 500 kernel log entries.
    pub oom_kills: u64,
}

/// One round trip: the guest answers `key=value` lines instead of the app running a
/// dozen ssh commands. `-n 500` bounds the kernel-log scan so a poll stays cheap.
const DIAGNOSTICS_SCRIPT: &str = r#"echo kernel=$(uname -r)
echo cpus=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)
echo load1=$(cut -d' ' -f1 /proc/loadavg)
echo load5=$(cut -d' ' -f2 /proc/loadavg)
echo load15=$(cut -d' ' -f3 /proc/loadavg)
echo uptime=$(cut -d. -f1 /proc/uptime)
awk '/^MemTotal:/{print "mem_total_kb="$2} /^MemAvailable:/{print "mem_available_kb="$2} /^SwapTotal:/{print "swap_total_kb="$2} /^SwapFree:/{print "swap_free_kb="$2}' /proc/meminfo
df -k / | awk 'NR==2{print "root_total_kb="$2; print "root_used_kb="$3}'
df -i / | awk 'NR==2{print "inodes_total="$2; print "inodes_used="$3}'
d=$(systemctl is-active docker 2>/dev/null); echo docker=${d:-unknown}
oom=$(journalctl -k -q --no-pager -n 500 2>/dev/null | grep -ci 'killed process'); echo oom=${oom:-0}"#;

fn kb(value: &str) -> u64 {
    value.trim().parse::<u64>().unwrap_or(0) * 1024
}

fn parse_diagnostics(raw: &str) -> VmDiagnostics {
    let mut d = VmDiagnostics { ok: true, ..Default::default() };
    for line in raw.lines() {
        let Some((key, value)) = line.trim().split_once('=') else { continue };
        let value = value.trim();
        match key {
            "kernel" => d.kernel = value.to_string(),
            "cpus" => d.cpus = value.parse().unwrap_or(0),
            "load1" => d.load1 = value.parse().unwrap_or(0.0),
            "load5" => d.load5 = value.parse().unwrap_or(0.0),
            "load15" => d.load15 = value.parse().unwrap_or(0.0),
            "uptime" => d.uptime_seconds = value.parse().unwrap_or(0),
            "mem_total_kb" => d.mem_total = kb(value),
            "mem_available_kb" => d.mem_available = kb(value),
            "swap_total_kb" => d.swap_total = kb(value),
            "swap_free_kb" => d.swap_free = kb(value),
            "root_total_kb" => d.root_total = kb(value),
            "root_used_kb" => d.root_used = kb(value),
            "inodes_total" => d.inodes_total = value.parse().unwrap_or(0),
            "inodes_used" => d.inodes_used = value.parse().unwrap_or(0),
            "docker" => d.docker_active = value == "active",
            "oom" => d.oom_kills = value.parse().unwrap_or(0),
            _ => {}
        }
    }
    d
}

/// Live health of the guest through `colima ssh`. A stopped VM returns ok=false with
/// Colima's message instead of an error, so the panel can explain rather than blank out.
pub fn vm_diagnostics(profile: &str) -> VmDiagnostics {
    let out = Command::new(colima_bin())
        .args(["ssh", "-p", profile, "--", "sh", "-c", DIAGNOSTICS_SCRIPT])
        .output();
    match out {
        Ok(o) if o.status.success() => parse_diagnostics(&String::from_utf8_lossy(&o.stdout)),
        Ok(o) => VmDiagnostics { ok: false, error: Some(humanize(&String::from_utf8_lossy(&o.stderr))), ..Default::default() },
        Err(e) => VmDiagnostics { ok: false, error: Some(format!("failed to spawn colima: {e}")), ..Default::default() },
    }
}

/// One directory entry inside a volume, as the guest reports it.
#[derive(Serialize, Clone, Default)]
pub struct VolumeEntry {
    /// `dir`, `file`, `link`, `char`, `block`, `pipe`, `socket` or `other`.
    pub kind: String,
    pub name: String,
    pub size: u64,
    pub modified: String,
    pub user: String,
    pub group: String,
    pub mode: String,
    /// Symlink target; empty for everything else.
    pub link: String,
}

#[derive(Serialize, Clone, Default)]
pub struct VolumeContents {
    /// The volume's data directory in the guest.
    pub root: String,
    /// The listed directory, relative to `root` (`""` for the root itself).
    pub path: String,
    pub entries: Vec<VolumeEntry>,
    /// True when the directory holds more entries than one listing returns.
    pub truncated: bool,
}

/// One `find` level per listing. Past this many rows the panel is not browsable anyway;
/// the flag lets the UI say so instead of silently dropping names.
const MAX_ENTRIES: usize = 5000;
/// Backstop for pathological output (very long names, a misbehaving client). A normal
/// 5000-row listing is well under a megabyte.
const MAX_BYTES: usize = 4 * 1024 * 1024;

/// GNU find `-printf` record: type, size, mtime, owner, group, mode, link target, name.
/// `\0` terminates each record, because a file name may contain any other byte.
const ENTRY_FORMAT: &str = r"%y\t%s\t%TY-%Tm-%TdT%TH:%TM:%TS\t%u\t%g\t%m\t%l\t%f\0";

fn kind_of(type_char: &str) -> &'static str {
    match type_char {
        "d" => "dir",
        "f" => "file",
        "l" => "link",
        "c" => "char",
        "b" => "block",
        "p" => "pipe",
        "s" => "socket",
        _ => "other",
    }
}

/// Joins a UI-supplied relative path onto the volume root one component at a time.
/// `..` cannot climb out and a leading `/` is inert, so the path stays lexically under
/// the root. Navigation never descends through a symlink (the listing reports one as a
/// link, not a directory); a crafted IPC call that names a symlink as an intermediate
/// component would still resolve it inside the guest, which is read-only and already
/// reachable by the same caller.
fn volume_path(root: &str, rel: &str) -> Result<String, String> {
    let mut path = root.trim_end_matches('/').to_string();
    if path.is_empty() {
        return Err("volume has no mountpoint".to_string());
    }
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => return Err("path cannot leave the volume".to_string()),
            _ => {
                path.push('/');
                path.push_str(part);
            }
        }
    }
    Ok(path)
}

fn parse_volume_record(record: &str) -> Option<VolumeEntry> {
    let mut f = record.splitn(8, '\t');
    let kind = kind_of(f.next()?);
    Some(VolumeEntry {
        kind: kind.to_string(),
        size: f.next().and_then(|s| s.parse().ok()).unwrap_or(0),
        modified: f.next()?.to_string(),
        user: f.next()?.to_string(),
        group: f.next()?.to_string(),
        mode: f.next()?.to_string(),
        link: f.next()?.to_string(),
        name: f.next()?.to_string(),
    })
}

#[cfg(test)]
fn parse_volume_entries(raw: &str) -> Vec<VolumeEntry> {
    raw.split('\0')
        .filter(|record| !record.is_empty())
        .filter_map(parse_volume_record)
        .collect()
}

/// Read-only listing of one volume directory through `colima ssh -- sudo find`, never a
/// helper container: the volume lives in the VM's own tree, not on the host.
pub fn volume_contents(profile: &str, root: &str, rel: &str) -> Result<VolumeContents, String> {
    let path = volume_path(root, rel)?;
    let mut child = Command::new(colima_bin())
        .args(["ssh", "-p", profile, "--", "sudo", "find", &path])
        .args(["-mindepth", "1", "-maxdepth", "1", "-printf", ENTRY_FORMAT])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn colima: {e}"))?;

    // stderr gets its own thread: a full pipe would block the child while this side is
    // still reading stdout, and `find` reports one line per unreadable entry.
    let errs = child.stderr.take().map(|mut pipe| {
        std::thread::spawn(move || {
            let mut text = String::new();
            let _ = pipe.read_to_string(&mut text);
            text
        })
    });

    // Parse incrementally and stop at the cap. Reading the whole listing first would let a
    // directory with millions of entries (which any container holding the volume can
    // create) buffer tens of megabytes just to discard all but 5000 rows.
    let mut entries = Vec::new();
    let mut truncated = false;
    if let Some(stdout) = child.stdout.take() {
        let mut reader = BufReader::new(stdout);
        let mut record = Vec::new();
        let mut bytes = 0usize;
        loop {
            record.clear();
            match reader.read_until(0, &mut record) {
                Ok(0) => break,
                Ok(n) => bytes += n,
                Err(_) => break,
            }
            let line = record.strip_suffix(b"\0").unwrap_or(&record);
            let text = String::from_utf8_lossy(line);
            if let Some(entry) = parse_volume_record(&text) {
                entries.push(entry);
            }
            // One row past the cap proves there is more; exactly the cap might be the end.
            if entries.len() > MAX_ENTRIES || bytes >= MAX_BYTES {
                truncated = true;
                let _ = child.kill();
                break;
            }
        }
    }

    let status = child.wait().map_err(|e| format!("wait for colima: {e}"))?;
    let stderr = errs.map(|t| t.join().unwrap_or_default()).unwrap_or_default();
    if !status.success() && !truncated {
        return Err(humanize(&stderr));
    }
    // The kept prefix is sorted, not the whole directory: ordering beyond the cap is lost
    // either way, and the count in the UI says the list is partial.
    entries.sort_by_key(|e| (e.kind != "dir", e.name.to_lowercase()));
    entries.truncate(MAX_ENTRIES);
    Ok(VolumeContents {
        root: root.trim_end_matches('/').to_string(),
        path: rel.trim_matches('/').to_string(),
        entries,
        truncated,
    })
}

pub fn nerdctl_install(profile: &str) -> Result<String, String> {
    let mut a: Vec<&str> = vec!["nerdctl", "install"];
    if profile != "default" { a.push("-p"); a.push(profile); }
    run(&a)
}
#[cfg(test)]
mod tests {
    use super::{humanize, rosetta_applies};

    #[test]
    fn instance_name_follows_the_colima_default() {
        assert_eq!(super::instance_name("default"), "colima");
        assert_eq!(super::instance_name("work"), "work");
    }

    #[test]
    fn rosetta_flag_only_for_vz() {
        assert!(rosetta_applies(None));
        assert!(rosetta_applies(Some("vz")));
        assert!(!rosetta_applies(Some("qemu")));
        assert!(!rosetta_applies(Some("krunkit")));
    }

    #[test]
    fn reads_the_version_off_the_first_line() {
        assert_eq!(super::version_from("colima version 0.10.3\ngit commit: abc\n"), Some("0.10.3".to_string()));
        assert_eq!(super::version_from("command not found"), None);
        assert_eq!(super::version_from(""), None);
    }

    #[test]
    fn parses_guest_diagnostics() {
        let raw = "kernel=6.8.0-117-generic\ncpus=4\nload1=0.07\nload5=0.32\nload15=0.32\nuptime=100280\n\
mem_total_kb=6053356\nmem_available_kb=5324848\nswap_total_kb=0\nswap_free_kb=0\n\
root_total_kb=19221248\nroot_used_kb=1468788\ninodes_total=2490368\ninodes_used=18192\n\
docker=active\noom=0\n";
        let d = super::parse_diagnostics(raw);
        assert!(d.ok);
        assert_eq!(d.kernel, "6.8.0-117-generic");
        assert_eq!(d.cpus, 4);
        assert_eq!(d.mem_total, 6053356 * 1024);
        assert_eq!(d.mem_available, 5324848 * 1024);
        assert_eq!(d.root_used, 1468788 * 1024);
        assert_eq!(d.inodes_total, 2490368);
        assert!(d.docker_active);
        assert_eq!(d.oom_kills, 0);
        assert_eq!(d.load1, 0.07);
    }

    #[test]
    fn missing_keys_leave_diagnostics_at_zero() {
        let d = super::parse_diagnostics("kernel=x\ndocker=inactive\noom=3\n");
        assert_eq!(d.mem_total, 0);
        assert!(!d.docker_active);
        assert_eq!(d.oom_kills, 3);
    }

    #[test]
    fn compares_release_versions() {
        assert_eq!(super::parse_version("v0.10.10"), Some((0, 10, 10)));
        assert_eq!(super::parse_version("0.9"), Some((0, 9, 0)));
        assert_eq!(super::parse_version("0.11.0-beta.1"), Some((0, 11, 0)));
        assert_eq!(super::parse_version("nightly"), None);
        assert!(super::parse_version("v0.10.10") > super::parse_version("0.10.3"));
        assert!(super::parse_version("0.10.3") == super::parse_version("v0.10.3"));
    }

    #[test]
    fn only_a_higher_tag_counts_as_an_update() {
        assert!(super::is_newer(Some("0.2.0"), "0.1.0"));
        assert!(!super::is_newer(Some("0.1.0"), "0.1.0"));
        assert!(!super::is_newer(Some("0.9.0"), "0.10.0"));
        // A failed lookup is not an update, however the local version reads.
        assert!(!super::is_newer(None, "0.1.0"));
        assert!(!super::is_newer(Some("nightly"), "0.1.0"));
    }

    #[test]
    fn strips_logrus_wrapper_and_unescapes_newlines() {
        let raw = "time=\"2026-11-11T19:02:46+01:00\" level=fatal msg=\"error in config: cannot use vmType: 'krunkit', error: krunkit not found in $PATH\\nInstall with: brew tap slp/krunkit && brew install krunkit\"\n";
        assert_eq!(
            humanize(raw),
            "error in config: cannot use vmType: 'krunkit', error: krunkit not found in $PATH\nInstall with: brew tap slp/krunkit && brew install krunkit"
        );
    }

    #[test]
    fn passes_plain_errors_through() {
        assert_eq!(humanize("  cannot connect  \n"), "cannot connect");
    }

    #[test]
    fn joins_a_relative_path_without_leaving_the_volume() {
        let root = "/var/lib/docker/volumes/data/_data";
        assert_eq!(super::volume_path(root, "").unwrap(), root);
        assert_eq!(super::volume_path(root, "/logs/app/").unwrap(), format!("{root}/logs/app"));
        assert_eq!(super::volume_path(root, "logs//./app").unwrap(), format!("{root}/logs/app"));
        assert!(super::volume_path(root, "..").is_err());
        assert!(super::volume_path(root, "logs/../../etc").is_err());
        assert!(super::volume_path("", "logs").is_err());
    }

    #[test]
    fn parses_nul_terminated_find_records() {
        // Every record is `type, size, mtime, user, group, mode, link, name`; link is empty
        // for anything that is not a symlink, and the name is the last field.
        let raw = "d\t4096\t2026-11-11T19:02:46.1234567890\troot\troot\t755\t\tlogs\0\
f\t12\t2026-11-11T19:03:00.0000000000\t1000\t1000\t644\t\tapp.json\0\
l\t7\t2026-11-11T19:03:01.0000000000\troot\troot\t777\t../app\tcurrent\0\
f\t0\t2026-11-11T19:04:00.0000000000\troot\troot\t600\t\tbad name\0";
        let e = super::parse_volume_entries(raw);
        assert_eq!(e.len(), 4);
        assert_eq!(e[0].kind, "dir");
        assert_eq!(e[0].name, "logs");
        assert_eq!(e[1].kind, "file");
        assert_eq!(e[1].name, "app.json");
        assert_eq!(e[1].size, 12);
        assert_eq!(e[1].user, "1000");
        assert_eq!(e[1].mode, "644");
        assert_eq!(e[2].kind, "link");
        assert_eq!(e[2].link, "../app");
        assert_eq!(e[3].name, "bad name");
        assert!(super::parse_volume_entries("").is_empty());
    }

    #[test]
    fn malformed_records_are_dropped_not_rendered() {
        // A truncated or foreign line must never become an entry with an empty name.
        assert!(super::parse_volume_entries("f\t1\t2026-11-11T00:00:00Z\troot\0").is_empty());
        assert!(super::parse_volume_entries("\0\0").is_empty());
    }
}
