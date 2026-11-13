use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// DOCKER_HOST of the profile selected in the UI. Docker commands run against it so
/// every list/action follows the active Colima profile.
static ENDPOINT: RwLock<Option<String>> = RwLock::new(None);
/// Container client for the selected profile. Colima's own `nerdctl` path is preferred
/// for containerd profiles; docker-runtime profiles only have the Docker CLI.
static CLIENT: RwLock<Client> = RwLock::new(Client::Docker);
/// Profile the two above describe. A late answer about another profile must not rewrite
/// them, because the user may have switched while that command was in flight.
static ACTIVE_PROFILE: RwLock<String> = RwLock::new(String::new());

#[derive(Clone)]
enum Client {
    Docker,
    ColimaNerdctl(String),
}

pub fn set_endpoint(host: Option<String>) {
    if let Ok(mut slot) = ENDPOINT.write() {
        *slot = host;
    }
    // A different daemon has different sizes; never answer with the previous profile's.
    invalidate_disk_usage();
}

/// Chooses how container commands reach this profile.
pub fn set_client(runtime: &str, profile: &str) {
    let next = if runtime.eq_ignore_ascii_case("containerd") {
        Client::ColimaNerdctl(profile.to_string())
    } else {
        Client::Docker
    };
    if let Ok(mut slot) = CLIENT.write() {
        *slot = next;
    }
    if let Ok(mut slot) = ACTIVE_PROFILE.write() {
        *slot = profile.to_string();
    }
}

/// Whether a reported socket should replace the current endpoint. Pure so the rule can be
/// tested without touching the process-wide endpoint the other tests read.
fn adopted_socket<'a>(active: &str, profile: &str, socket: &'a str, current: Option<&str>) -> Option<&'a str> {
    let socket = socket.trim();
    if socket.is_empty() || active != profile || current == Some(socket) {
        return None;
    }
    Some(socket)
}

/// A `colima status` answer that arrived after the switch it was started for. The socket
/// is colima's own convention in every normal install, so this only ever replaces the
/// guessed path with the reported one — and only while that profile is still the active
/// one, so a switch that landed first is never undone.
pub fn confirm_endpoint(profile: &str, socket: &str) {
    let active = ACTIVE_PROFILE.read().map(|p| p.clone()).unwrap_or_default();
    let current = ENDPOINT.read().ok().and_then(|slot| slot.clone());
    if let Some(socket) = adopted_socket(&active, profile, socket, current.as_deref()) {
        set_endpoint(Some(socket.to_string()));
    }
}

/// argv for the Colima-managed nerdctl client. Kept pure so it can be tested without
/// a containerd profile on the machine.
fn nerdctl_argv(profile: &str, args: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = vec!["--profile".into(), profile.into(), "nerdctl".into(), "--".into()];
    out.extend(args.iter().map(|a| a.to_string()));
    out
}

/// `docker events` argv for the live-refresh stream. The type filters keep the volume down:
/// exec, health-check and plugin events never change what a view renders.
const EVENTS_ARGS: &[&str] = &[
    "events",
    "--filter", "type=container",
    "--filter", "type=image",
    "--filter", "type=network",
    "--filter", "type=volume",
    "--format", "{{json .}}",
];

/// Kept pure so the containerd decision is testable without touching the process-wide client.
fn events_argv_for(client: &Client) -> Option<&'static [&'static str]> {
    match client {
        Client::ColimaNerdctl(_) => None,
        Client::Docker => Some(EVENTS_ARGS),
    }
}

/// A `docker events` child for the active profile, or None on the containerd client.
/// nerdctl's stream carries only a `/tasks/exit`-style topic, has no `--since` to replay a
/// dropped connection, and no type filter, so those profiles keep the timed refresh.
pub fn events_command() -> Option<Command> {
    let client = CLIENT.read().map(|c| c.clone()).unwrap_or(Client::Docker);
    let args = events_argv_for(&client)?;
    let mut cmd = Command::new("docker");
    cmd.args(args);
    if let Some(host) = ENDPOINT.read().ok().and_then(|slot| slot.clone()) {
        cmd.env("DOCKER_HOST", host);
    }
    Some(cmd)
}

/// `docker stats <id>` argv without `--no-stream`: the child keeps emitting one JSON line
/// per second until it is killed, which is what makes the Performance panel live.
fn stats_argv(id: &str) -> Vec<&str> {
    vec!["stats", "--format", "{{json .}}", id]
}

/// A long-running stats child for the active profile. Both clients stream: Colima's
/// nerdctl wrapper mirrors docker's `stats --format` fields and one-second interval.
pub fn stats_command(id: &str) -> Command {
    let client = CLIENT.read().map(|c| c.clone()).unwrap_or(Client::Docker);
    let args = stats_argv(id);
    match client {
        Client::Docker => docker_command(&args),
        Client::ColimaNerdctl(profile) => {
            let mut cmd = Command::new("colima");
            cmd.args(nerdctl_argv(&profile, &args));
            cmd
        }
    }
}

/// Which client answers for the active profile. Colima's nerdctl wrapper is the only
/// client a containerd profile has; the Docker CLI is the fallback everywhere else.
pub fn client_label() -> &'static str {
    match CLIENT.read().map(|c| c.clone()).unwrap_or(Client::Docker) {
        Client::Docker => "docker",
        Client::ColimaNerdctl(_) => "nerdctl",
    }
}

pub(crate) fn run_docker(args: &[&str]) -> Result<String, String> {
    let client = CLIENT.read().map(|c| c.clone()).unwrap_or(Client::Docker);
    let mut cmd = match client {
        Client::Docker => docker_command(args),
        Client::ColimaNerdctl(profile) => {
            let mut cmd = Command::new("colima");
            cmd.args(nerdctl_argv(&profile, args));
            cmd
        }
    };
    run_output(&mut cmd)
}

/// The Docker CLI with the selected profile's endpoint. Cleanup uses it as a fallback when
/// the nerdctl wrapper cannot run a command (older nerdctl builds, containerd quirks).
pub(crate) fn run_docker_cli(args: &[&str]) -> Result<String, String> {
    run_output(&mut docker_command(args))
}

/// One container-client command, nerdctl first: the profile's own client (Colima's nerdctl
/// wrapper on containerd profiles) gets the call, and only when that path fails and the
/// Docker CLI is installed does the Docker client get one attempt. Returns the output and
/// the client that answered, which decides how its rows must be read.
pub(crate) fn run_client(args: &[&str]) -> (Result<String, String>, &'static str) {
    let error = match run_docker(args) {
        Ok(raw) => return (Ok(raw), client_label()),
        Err(error) => error,
    };
    if client_label() == "nerdctl" && crate::tools::which_bin("docker").is_some() {
        if let Ok(raw) = run_docker_cli(args) {
            return (Ok(raw), "docker");
        }
    }
    (Err(error), client_label())
}

fn docker_command(args: &[&str]) -> Command {
    let mut cmd = Command::new("docker");
    cmd.args(args);
    if let Some(host) = ENDPOINT.read().ok().and_then(|slot| slot.clone()) {
        cmd.env("DOCKER_HOST", host);
    }
    cmd
}

fn run_output(cmd: &mut Command) -> Result<String, String> {
    let out = cmd
        .output()
        .map_err(|e| format!("failed to spawn container client: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    // A successful run that printed only to stderr is never real data (e.g. the client
    // printing its usage when argv is lost). Surface it instead of rendering empty views.
    if stdout.trim().is_empty() && !out.stderr.is_empty() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(stdout)
}

#[cfg(test)]
mod client_tests {
    use super::{events_argv_for, nerdctl_argv, Client};

    #[test]
    fn colima_nerdctl_is_the_containerd_path() {
        assert_eq!(
            nerdctl_argv("work", &["ps", "-a"]),
            vec!["--profile", "work", "nerdctl", "--", "ps", "-a"]
        );
    }

    #[test]
    fn only_the_docker_client_streams_events() {
        assert!(events_argv_for(&Client::Docker).is_some());
        assert!(events_argv_for(&Client::ColimaNerdctl("work".into())).is_none());
    }

    #[test]
    fn stats_argv_streams_and_targets_one_container() {
        let args = super::stats_argv("abc123");
        assert!(!args.contains(&"--no-stream"), "the panel needs a stream, not one shot");
        assert_eq!(args.last(), Some(&"abc123"));
    }

    #[test]
    fn stats_lines_lose_their_cursor_controls() {
        // Verbatim shape of one streaming line from `docker stats --format {{json .}}`.
        let raw = "\u{1b}[J\u{1b}[H{\"ID\":\"abc\",\"CPUPerc\":\"1.5%\"}\r";
        assert_eq!(super::strip_ansi(raw), "{\"ID\":\"abc\",\"CPUPerc\":\"1.5%\"}\r");
    }

    #[test]
    fn one_streamed_second_is_one_clean_sample() {
        let line = concat!(
            "\u{1b}[J\u{1b}[H{\"BlockIO\":\"5.17MB / 0B\",\"CPUPerc\":\"1.5%\",",
            "\"Container\":\"demo\",\"ID\":\"abc\",\"MemPerc\":\"9.9%\",",
            "\"MemUsage\":\"203MiB / 2GiB\",\"Name\":\"demo\",",
            "\"NetIO\":\"1.5MiB / 2.5MiB\",\"PIDs\":\"9\"}\r\n",
        );
        let mut seen = Vec::new();
        super::read_stats_lines(
            format!("{line}\u{1b}[K\n{line}").as_bytes(),
            |stat| { seen.push(stat); true },
        );
        assert_eq!(seen.len(), 1, "the half-second redraw must not become a second point");
        assert_eq!(seen[0].cpu, 1.5);
        assert_eq!(seen[0].mem, 203 * 1024 * 1024);
        assert_eq!(seen[0].pids, 9);
        assert!(seen[0].net_rx > 0);
    }
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: String,
    pub created_at: String,
    pub state: String,
    pub pod_name: String,
    pub pod_namespace: String,
    pub compose_project: String,
    pub mounts: String,
}

pub fn list_containers() -> Result<Vec<Container>, String> {
    let raw = run_docker(&[
        "ps", "-a", "--format",
        "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}\t{{.CreatedAt}}\t{{.State}}\t{{.Label \"io.kubernetes.pod.name\"}}\t{{.Label \"io.kubernetes.pod.namespace\"}}\t{{.Label \"com.docker.compose.project\"}}\t{{.Mounts}}",
    ])?;
    Ok(raw.lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 7 { return None; }
        Some(Container {
            id: f[0].into(), name: f[1].into(), image: f[2].into(), status: f[3].into(),
            ports: f[4].into(), created_at: f[5].into(), state: f[6].into(),
            pod_name: f.get(7).map(|s| s.to_string()).unwrap_or_default(),
            pod_namespace: f.get(8).map(|s| s.to_string()).unwrap_or_default(),
            compose_project: f.get(9).map(|s| s.to_string()).unwrap_or_default(),
            mounts: f.get(10).map(|s| s.to_string()).unwrap_or_default(),
        })
    }).collect())
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Image {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

const IMAGE_FORMAT: &str = "{{.ID}}\t{{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}";

fn parse_images(raw: &str) -> Vec<Image> {
    raw.lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 5 { return None; }
        Some(Image {
            id: f[0].into(), repository: f[1].into(), tag: f[2].into(),
            size: f[3].into(), created: f[4].into(),
        })
    }).collect()
}

/// Base list plus rows it does not already hold, keyed by id+repository+tag.
fn merge_images(base: &mut Vec<Image>, extra: Vec<Image>) {
    for img in extra {
        if !base.iter().any(|i| i.id == img.id && i.repository == img.repository && i.tag == img.tag) {
            base.push(img);
        }
    }
}

/// Tagged images plus the untagged ones. Colima's nerdctl lists untagged images in its normal
/// listing (`<none>` repository). The Docker CLI from v29 hides them unless asked by filter
/// (`-a` would add every build layer), so a docker answer is topped up with one extra call.
pub fn list_images() -> Result<Vec<Image>, String> {
    let (raw, client) = run_client(&["images", "--format", IMAGE_FORMAT]);
    let mut images = parse_images(&raw?);
    if client == "docker" {
        if let (Ok(raw), _) = run_client(&["images", "--filter", "dangling=true", "--format", IMAGE_FORMAT]) {
            merge_images(&mut images, parse_images(&raw));
        }
    }
    Ok(images)
}

#[derive(Deserialize, Serialize, Clone)]
pub struct Volume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
}

pub fn list_volumes() -> Result<Vec<Volume>, String> {
    let raw = run_docker(&[
        "volume", "ls", "--format", "{{.Name}}\t{{.Driver}}\t{{.Mountpoint}}",
    ])?;
    Ok(raw.lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 3 { return None; }
        Some(Volume { name: f[0].into(), driver: f[1].into(), mountpoint: f[2].into() })
    }).collect())
}

pub fn container_logs(id: &str, tail: u32) -> Result<String, String> {
    run_docker(&["logs", "--timestamps", "--tail", &tail.to_string(), id])
}

pub fn container_action(id: &str, action: &str) -> Result<String, String> {
    let args: Vec<&str> = match action {
        "start" => vec!["start", id],
        "stop" => vec!["stop", id],
        "restart" => vec!["restart", id],
        "remove" => vec!["rm", "-f", id],
        _ => return Err(format!("unknown action: {action}")),
    };
    let out = run_docker(&args);
    if action == "remove" {
        invalidate_disk_usage();
    }
    out
}

pub fn inspect(id: &str) -> Result<String, String> { run_docker(&["inspect", id]) }

/// Docker refuses a memory limit under 6 MiB on Linux.
const MIN_MEMORY_LIMIT: u64 = 6 * 1024 * 1024;

fn update_memory_args(id: &str, bytes: u64) -> Result<Vec<String>, String> {
    if id.is_empty() || id.starts_with('-') {
        return Err("invalid container id".to_string());
    }
    // `docker update --memory 0` is accepted and then ignored: a limit cannot be removed from
    // an existing container, only from a new one.
    if bytes == 0 {
        return Err("Docker cannot remove a memory limit from a live container; recreate it without --memory".to_string());
    }
    if bytes < MIN_MEMORY_LIMIT {
        return Err(format!(
            "memory limit must be at least {} MiB",
            MIN_MEMORY_LIMIT / (1024 * 1024)
        ));
    }
    // Swap follows memory: raising the limit while a lower swap ceiling stays behind makes
    // the client reject the update, and 0 clears both ceilings together.
    Ok(vec![
        "update".to_string(),
        format!("--memory={bytes}"),
        format!("--memory-swap={bytes}"),
        id.to_string(),
    ])
}

/// Change a live container's cgroup memory limit without recreating it. Raising it is the
/// way out of an imminent OOM kill; setting one on an unlimited container confines the
/// damage to that container instead of the whole guest.
pub fn container_update_memory(id: &str, bytes: u64) -> Result<String, String> {
    let args = update_memory_args(id, bytes)?;
    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run_docker(&borrowed)
}

pub fn image_remove(id: &str) -> Result<String, String> {
    let out = run_docker(&["rmi", "-f", id]);
    invalidate_disk_usage();
    out
}
pub fn volume_remove(name: &str) -> Result<String, String> {
    let out = run_docker(&["volume", "rm", "-f", name]);
    invalidate_disk_usage();
    out
}

/// The volume's `_data` directory inside the guest, straight from the client so it matches
/// the active runtime: Docker keeps volumes under `/var/lib/docker`, containerd elsewhere.
pub fn volume_mountpoint(name: &str) -> Result<String, String> {
    let raw = run_docker(&["volume", "inspect", "--format", "{{.Mountpoint}}", name])?;
    let path = raw.trim();
    if path.is_empty() {
        return Err(format!("volume {name} reports no mountpoint"));
    }
    Ok(path.to_string())
}
/// Removes a user-defined network. Docker rejects built-in networks (bridge/host/none)
/// and any network with attached containers, so the CLI error is surfaced verbatim.
pub fn network_remove(name: &str) -> Result<String, String> { run_docker(&["network", "rm", name]) }
#[derive(Deserialize, Serialize, Clone)]
pub struct Network { pub name: String, pub driver: String, pub scope: String }

pub fn list_networks() -> Result<Vec<Network>, String> {
    let raw = run_docker(&["network", "ls", "--format", "{{.Name}}\t{{.Driver}}\t{{.Scope}}"])?;
    Ok(raw.lines().filter_map(|line| {
        let f: Vec<&str> = line.split('\t').collect();
        if f.len() < 3 { return None; }
        Some(Network { name: f[0].into(), driver: f[1].into(), scope: f[2].into() })
    }).collect())
}

#[derive(serde::Deserialize, Clone)]
pub struct PruneOpts {
    pub containers: bool,
    pub networks: bool,
    pub images: bool,
    pub all_images: bool,
    pub volumes: bool,
    pub build_cache: bool,
}

pub fn prune(o: &PruneOpts) -> Result<String, String> {
    let mut out = String::new();
    let mut errors = Vec::new();
    let jobs: Vec<(&[&str; 3], bool)> = vec![
        (&["container", "prune", "-f"], o.containers),
        (&["network", "prune", "-f"], o.networks),
        (&["builder", "prune", "-f"], o.build_cache),
        (&["volume", "prune", "-f"], o.volumes),
    ];
    for (args, enabled) in jobs {
        if !enabled { continue; }
        match run_docker(args) {
            Ok(s) => out.push_str(&s),
            Err(e) => errors.push(e),
        }
    }
    if o.all_images {
        match run_docker(&["image", "prune", "-af"]) { Ok(s) => out.push_str(&s), Err(e) => errors.push(e) }
    } else if o.images {
        match run_docker(&["image", "prune", "-f"]) { Ok(s) => out.push_str(&s), Err(e) => errors.push(e) }
    }
    if out.trim().is_empty() && !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    invalidate_disk_usage();
    if !errors.is_empty() { out.push_str("\nWarnings:\n"); out.push_str(&errors.join("\n")); }
    Ok(out)
}

#[derive(Serialize, Clone, Default)]
pub struct DiskUsage {
    pub images: u64,
    pub containers: u64,
    pub volumes: u64,
    pub build_cache: u64,
    pub reclaimable: u64,
}

/// `docker system df` walks the VM's disk and costs ~1.3 s on a real profile, so it is
/// the most expensive call a refresh makes. Sizes only move on pull/build/prune; a
/// reading is reused for a minute and cleared by the operations that change it.
const DISK_TTL: Duration = Duration::from_secs(60);
static DISK_CACHE: RwLock<Option<(Instant, DiskUsage)>> = RwLock::new(None);

fn invalidate_disk_usage() {
    if let Ok(mut slot) = DISK_CACHE.write() {
        *slot = None;
    }
    if let Ok(mut slot) = VOLUME_SIZES_CACHE.write() {
        *slot = None;
    }
}

#[derive(Serialize, Clone)]
pub struct VolumeSize {
    pub name: String,
    pub size: u64,
}

/// Per-volume sizes come from the same `system df -v` walk as the disk totals, so they
/// share its one-minute cache instead of paying for the scan on every Volumes visit.
static VOLUME_SIZES_CACHE: RwLock<Option<(Instant, Vec<VolumeSize>)>> = RwLock::new(None);

fn read_volume_sizes() -> Option<Vec<VolumeSize>> {
    let raw = run_docker(&["system", "df", "-v", "--format", "{{json .Volumes}}"]).ok()?;
    let rows: Vec<serde_json::Value> = serde_json::from_str(raw.trim()).ok()?;
    Some(
        rows.iter()
            .filter_map(|v| {
                Some(VolumeSize {
                    name: v["Name"].as_str()?.to_string(),
                    size: v["Size"].as_str().map(parse_size).unwrap_or(0),
                })
            })
            .collect(),
    )
}

/// Every volume the client can size, largest first. Empty when the client cannot report.
pub fn volume_sizes() -> Vec<VolumeSize> {
    if let Ok(slot) = VOLUME_SIZES_CACHE.read() {
        if let Some((at, cached)) = slot.as_ref() {
            if at.elapsed() < DISK_TTL {
                return cached.clone();
            }
        }
    }
    let Some(mut fresh) = read_volume_sizes() else {
        return Vec::new();
    };
    fresh.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.name.cmp(&b.name)));
    if let Ok(mut slot) = VOLUME_SIZES_CACHE.write() {
        *slot = Some((Instant::now(), fresh.clone()));
    }
    fresh
}

pub(crate) fn parse_size(s: &str) -> u64 {
    let s = s.split(" (").next().unwrap_or(s).trim();
    let idx = s.find(|c: char| c.is_alphabetic()).unwrap_or(s.len());
    let (num, unit) = s.split_at(idx);
    let n: f64 = num.trim().parse().unwrap_or(0.0);
    let mult = match unit.trim() {
        "B" => 1.0,
        "kB" | "KB" => 1e3,
        "MB" => 1e6,
        "GB" => 1e9,
        "TB" => 1e12,
        _ => 1.0,
    };
    (n * mult) as u64
}

pub fn disk_usage() -> DiskUsage {
    if let Ok(slot) = DISK_CACHE.read() {
        if let Some((at, cached)) = slot.as_ref() {
            if at.elapsed() < DISK_TTL {
                return cached.clone();
            }
        }
    }
    // A failed read (daemon stopped, nerdctl without `system df`) must not be cached:
    // that would pin zeros for the whole TTL after one transient error.
    let Some(fresh) = read_disk_usage() else {
        return DiskUsage::default();
    };
    if let Ok(mut slot) = DISK_CACHE.write() {
        *slot = Some((Instant::now(), fresh.clone()));
    }
    fresh
}

fn read_disk_usage() -> Option<DiskUsage> {
    #[derive(Deserialize)]
    struct Row { #[serde(rename = "Type")] kind: String, #[serde(rename = "Size")] size: String, #[serde(rename = "Reclaimable")] reclaimable: String }
    let raw = run_docker(&["system", "df", "--format", "{{json .}}"]).ok()?;
    let mut d = DiskUsage::default();
    let mut parsed_any = false;
    for line in raw.lines() {
        let Ok(r) = serde_json::from_str::<Row>(line.trim()) else {
            continue;
        };
        parsed_any = true;
        let v = parse_size(&r.size);
        match r.kind.as_str() {
            "Images" => d.images = v,
            "Containers" => d.containers = v,
            "Local Volumes" => d.volumes = v,
            "Build Cache" => d.build_cache = v,
            _ => {}
        }
        d.reclaimable += parse_size(&r.reclaimable);
    }
    parsed_any.then_some(d)
}

#[derive(Serialize, Clone)]
pub struct ContainerStat {
    pub id: String,
    pub name: String,
    /// Percent of one CPU; Docker reports >100 for multi-core containers.
    pub cpu: f64,
    pub mem: u64,
    pub mem_limit: u64,
    pub mem_pct: f64,
    pub pids: u32,
    pub net_rx: u64,
    pub net_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
}

#[derive(Deserialize)]
struct RawStat {
    #[serde(rename = "ID")] id: String,
    #[serde(rename = "Name")] name: String,
    #[serde(rename = "CPUPerc")] cpu: String,
    #[serde(rename = "MemPerc")] mem_pct: String,
    #[serde(rename = "MemUsage")] mem_usage: String,
    #[serde(rename = "PIDs")] pids: String,
    #[serde(rename = "NetIO")] net_io: String,
    #[serde(rename = "BlockIO")] block_io: String,
}

fn percent(s: &str) -> f64 {
    s.trim().trim_end_matches('%').parse::<f64>().unwrap_or(0.0)
}

/// "202.3MiB" / "1.5GiB" / "0B" → bytes.
fn human_bytes(s: &str) -> u64 {
    let s = s.trim();
    let split = s.find(|c: char| !c.is_ascii_digit() && c != '.').unwrap_or(s.len());
    let (num, unit) = s.split_at(split);
    let n: f64 = num.parse().unwrap_or(0.0);
    let mult = match unit.trim().to_ascii_lowercase().as_str() {
        "b" => 1.0,
        "kib" | "kb" => 1024.0,
        "mib" | "mb" => 1024.0 * 1024.0,
        "gib" | "gb" => 1024.0 * 1024.0 * 1024.0,
        "tib" | "tb" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (n * mult) as u64
}

/// `docker stats` redraws in place even when its stdout is a pipe: every sample arrives
/// wrapped in cursor controls (`ESC [ J`, `ESC [ H`). JSON cannot start with those.
pub fn strip_ansi(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        // A CSI sequence is ESC `[`, parameter bytes, then one final byte 0x40..=0x7e.
        if chars.next() != Some('[') {
            continue;
        }
        for c in chars.by_ref() {
            if ('@'..='~').contains(&c) {
                break;
            }
        }
    }
    out
}

pub(crate) fn parse_stat_line(line: &str) -> Option<ContainerStat> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    let s: RawStat = serde_json::from_str(t).ok()?;
    let mut parts = s.mem_usage.split('/');
    let mem = human_bytes(parts.next().unwrap_or("0"));
    let mem_limit = human_bytes(parts.next().unwrap_or("0"));
    let mut net = s.net_io.split('/');
    let net_rx = human_bytes(net.next().unwrap_or("0"));
    let net_tx = human_bytes(net.next().unwrap_or("0"));
    let mut block = s.block_io.split('/');
    let block_read = human_bytes(block.next().unwrap_or("0"));
    let block_write = human_bytes(block.next().unwrap_or("0"));
    Some(ContainerStat {
        id: s.id,
        name: s.name,
        cpu: percent(&s.cpu),
        mem,
        mem_limit,
        mem_pct: percent(&s.mem_pct),
        pids: s.pids.trim().parse().unwrap_or(0),
        net_rx,
        net_tx,
        block_read,
        block_write,
    })
}

pub fn container_stats() -> Result<Vec<ContainerStat>, String> {
    let raw = run_docker(&["stats", "--no-stream", "--format", "{{json .}}"])?;
    Ok(raw.lines().filter_map(parse_stat_line).collect())
}

/// One `stats --no-stream` round trip for the investigator's live panel.
pub fn container_stats_one(id: &str) -> Result<ContainerStat, String> {
    let raw = run_docker(&["stats", "--no-stream", "--format", "{{json .}}", id])?;
    raw.lines()
        .find_map(parse_stat_line)
        .ok_or_else(|| format!("no live stats reported for {id}"))
}

/// Docker's streaming `stats` redraws at 2 Hz but only produces a fresh reading once a
/// second; forward one sample per second so chart points and network deltas stay honest.
const STATS_MIN_GAP: Duration = Duration::from_millis(700);

/// Reads a streaming `docker stats` child's stdout until EOF or until `emit` returns false.
/// Lines are ANSI-stripped before parsing because the CLI keeps its redraw controls even
/// through a pipe. Returns false when the caller stopped early.
pub fn read_stats_lines<R: std::io::BufRead>(reader: R, mut emit: impl FnMut(ContainerStat) -> bool) -> bool {
    let mut last = Instant::now() - STATS_MIN_GAP;
    for raw in reader.lines().map_while(Result::ok) {
        let Some(stat) = parse_stat_line(&strip_ansi(&raw)) else { continue };
        if last.elapsed() < STATS_MIN_GAP { continue; }
        last = Instant::now();
        if !emit(stat) { return false; }
    }
    true
}

#[derive(Serialize, Clone)]
pub struct NetworkContainer {
    pub name: String,
    pub ip: String,
    pub mac: String,
}

#[derive(Serialize, Clone)]
pub struct NetworkMapEntry {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub internal: bool,
    pub subnet: String,
    pub gateway: String,
    pub containers: Vec<NetworkContainer>,
}

pub fn network_map() -> Result<Vec<NetworkMapEntry>, String> {
    let ids = run_docker(&["network", "ls", "-q"])?;
    let ids: Vec<&str> = ids.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut args = vec!["network", "inspect"];
    args.extend(ids);
    let raw = run_docker(&args)?;
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse networks: {e}"))?;
    let mut out = Vec::new();
    for net in parsed {
        let name = net["Name"].as_str().unwrap_or_default().to_string();
        let mut containers = Vec::new();
        if let Some(map) = net["Containers"].as_object() {
            for (_, c) in map {
                containers.push(NetworkContainer {
                    name: c["Name"].as_str().unwrap_or_default().to_string(),
                    ip: c["IPv4Address"].as_str().unwrap_or_default().to_string(),
                    mac: c["MacAddress"].as_str().unwrap_or_default().to_string(),
                });
            }
        }
        containers.sort_by(|a, b| a.name.cmp(&b.name));
        let ipam = net["IPAM"]["Config"].as_array().and_then(|a| a.first());
        out.push(NetworkMapEntry {
            id: net["Id"].as_str().unwrap_or_default().chars().take(12).collect(),
            name,
            driver: net["Driver"].as_str().unwrap_or_default().to_string(),
            scope: net["Scope"].as_str().unwrap_or_default().to_string(),
            internal: net["Internal"].as_bool().unwrap_or(false),
            subnet: ipam.and_then(|c| c["Subnet"].as_str()).unwrap_or_default().to_string(),
            gateway: ipam.and_then(|c| c["Gateway"].as_str()).unwrap_or_default().to_string(),
            containers,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{adopted_socket, disk_usage, human_bytes, percent, set_endpoint, DiskUsage, DISK_CACHE};
    use std::time::Instant;

    /// The launch sets the socket from colima's convention and asks `colima status` to
    /// confirm it behind the caller. That late answer belongs to the profile it was started
    /// for: a switch that landed first must not be undone by it, and an empty socket (a
    /// stopped profile) must not replace a working one.
    #[test]
    fn late_status_only_confirms_the_active_profile() {
        assert_eq!(adopted_socket("alpha", "beta", "unix:///beta.sock", Some("unix:///alpha.sock")), None);
        assert_eq!(adopted_socket("alpha", "alpha", "unix:///elsewhere.sock", Some("unix:///alpha.sock")), Some("unix:///elsewhere.sock"));
        assert_eq!(adopted_socket("alpha", "alpha", "unix:///alpha.sock", Some("unix:///alpha.sock")), None);
        assert_eq!(adopted_socket("alpha", "alpha", "  ", Some("unix:///alpha.sock")), None);
    }

    /// The `docker system df` reading must be served from cache: a refresh that paid
    /// 1.3 s for it every 15 s was the slowest part of the app.
    #[test]
    fn disk_usage_is_cached_until_invalidated() {
        let seeded = DiskUsage { images: 42, containers: 7, volumes: 3, build_cache: 1, reclaimable: 9 };
        *DISK_CACHE.write().expect("cache lock") = Some((Instant::now(), seeded));
        assert_eq!(disk_usage().images, 42);
        set_endpoint(Some("unix:///nonexistent.sock".into()));
        assert!(DISK_CACHE.read().expect("cache lock").is_none());
    }

    /// Untagged rows are new information, a tagged row already in the base list is not.
    #[test]
    fn merges_untagged_images_without_duplicates() {
        let mut images = super::parse_images("abc\tnginx\tlatest\t10MB\t2 days ago\n");
        super::merge_images(
            &mut images,
            super::parse_images("abc\tnginx\tlatest\t10MB\t2 days ago\ndef\t<none>\t<none>\t5MB\t1 hour ago\n"),
        );
        assert_eq!(images.len(), 2);
        assert!(images.iter().any(|i| i.id == "def" && i.repository == "<none>" && i.tag == "<none>"));
    }

    #[test]
    fn parses_human_sizes() {
        assert_eq!(human_bytes("0B"), 0);
        assert_eq!(human_bytes("512KiB"), 524288);
        assert_eq!(human_bytes("202.3MiB"), 212126924);
        assert_eq!(human_bytes("1.5GiB"), 1610612736);
        assert_eq!(human_bytes("2GB"), 2147483648);
    }

    #[test]
    fn parses_percentages() {
        assert_eq!(percent("5.30%"), 5.3);
        assert_eq!(percent("0.00%"), 0.0);
        assert_eq!(percent("garbage"), 0.0);
    }

    /// Both ceilings move together, and a value the client would reject never becomes argv.
    #[test]
    fn memory_update_sets_both_ceilings() {
        assert_eq!(
            super::update_memory_args("abc", 2 * 1024 * 1024 * 1024).unwrap(),
            vec!["update", "--memory=2147483648", "--memory-swap=2147483648", "abc"]
        );
        // Docker accepts `--memory 0` and ignores it, so removal is an error here instead.
        assert!(super::update_memory_args("abc", 0).is_err());
        assert!(super::update_memory_args("abc", 1024 * 1024).is_err());
        assert!(super::update_memory_args("--force", 1024 * 1024).is_err());
        assert!(super::update_memory_args("", 1024 * 1024).is_err());
    }
}

#[derive(Serialize, Clone)]
pub struct ContainerMount {
    pub source: String,
    pub destination: String,
    pub mode: String,
    pub kind: String,
}

#[derive(Serialize, Clone)]
pub struct ContainerNet {
    pub name: String,
    pub ip: String,
    pub ipv6: String,
    pub mac: String,
    pub gateway: String,
}

/// One published or merely exposed port of a container.
#[derive(Serialize, Clone)]
pub struct ContainerPort {
    /// Port as declared by the image, e.g. `5900`.
    pub container: String,
    pub proto: String,
    pub host_ip: String,
    /// Empty for ports the image exposes without publishing.
    pub host_port: String,
}

/// One entry of the container health check log.
#[derive(Serialize, Clone)]
pub struct HealthProbe {
    pub start: String,
    pub exit_code: i64,
    pub output: String,
}

#[derive(Serialize, Clone)]
pub struct ContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub image_id: String,
    pub command: String,
    pub created: String,
    pub started_at: String,
    pub finished_at: String,
    pub state: String,
    pub health: String,
    pub restart_policy: String,
    pub restart_count: u64,
    pub restart_max: u64,
    pub mounts: Vec<ContainerMount>,
    pub networks: Vec<ContainerNet>,
    pub env_count: usize,
    pub env: Vec<(String, String)>,
    pub labels: Vec<(String, String)>,
    pub ports: Vec<ContainerPort>,
    pub hostname: String,
    pub workdir: String,
    pub user: String,
    pub entrypoint: String,
    pub cmd: String,
    pub health_test: String,
    /// Health check timings in nanoseconds as Docker reports them.
    pub health_interval: u64,
    pub health_timeout: u64,
    pub health_retries: u64,
    pub health_log: Vec<HealthProbe>,
    pub memory_limit: u64,
    pub nano_cpus: i64,
    pub pid: i64,
    /// True when the last exit was an OOM kill, which is how a container shows up
    /// after Docker's kernel victim rather than a clean stop.
    pub oom_killed: bool,
}

pub fn container_detail(id: &str) -> Result<ContainerDetail, String> {
    let raw = run_docker(&["inspect", id])?;
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse inspect: {e}"))?;
    let c = parsed.first().ok_or("container not found")?;
    let text = |v: &str| c[v].as_str().unwrap_or_default().to_string();

    let arg_list = |path: &[&str]| -> Vec<String> {
        let mut cur = c;
        for key in path {
            cur = &cur[*key];
        }
        cur.as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let command = {
        let mut parts = arg_list(&["Config", "Entrypoint"]);
        parts.extend(arg_list(&["Config", "Cmd"]));
        if parts.is_empty() {
            vec![text("Path")].into_iter().filter(|s| !s.is_empty()).collect()
        } else {
            parts
        }
        .join(" ")
    };

    let mut mounts = Vec::new();
    if let Some(list) = c["Mounts"].as_array() {
        for m in list {
            mounts.push(ContainerMount {
                source: m["Source"].as_str().unwrap_or_default().to_string(),
                destination: m["Destination"].as_str().unwrap_or_default().to_string(),
                mode: m["Mode"].as_str().unwrap_or_default().to_string(),
                kind: m["Type"].as_str().unwrap_or_default().to_string(),
            });
        }
    }

    let mut networks = Vec::new();
    if let Some(map) = c["NetworkSettings"]["Networks"].as_object() {
        for (name, net) in map {
            networks.push(ContainerNet {
                name: name.clone(),
                ip: net["IPAddress"].as_str().unwrap_or_default().to_string(),
                ipv6: net["GlobalIPv6Address"].as_str().unwrap_or_default().to_string(),
                mac: net["MacAddress"].as_str().unwrap_or_default().to_string(),
                gateway: net["Gateway"].as_str().unwrap_or_default().to_string(),
            });
        }
    }
    networks.sort_by(|a, b| a.name.cmp(&b.name));

    let mut labels: Vec<(String, String)> = c["Config"]["Labels"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect())
        .unwrap_or_default();
    labels.sort_by(|a, b| a.0.cmp(&b.0));

    let env: Vec<(String, String)> = c["Config"]["Env"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| s.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect()
        })
        .unwrap_or_default();

    // Ports the image exposes plus what the runtime actually published. Keys look like
    // `5900/tcp`; a null binding means exposed but not published.
    let mut ports: Vec<ContainerPort> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut push = |key: &str, bindings: Option<&Vec<serde_json::Value>>, ports: &mut Vec<ContainerPort>| {
        let (container, proto) = key.split_once('/').unwrap_or((key, ""));
        let id = format!("{container}/{proto}");
        if !seen.insert(id) {
            return;
        }
        let list: &[serde_json::Value] = bindings.map(|b| b.as_slice()).unwrap_or(&[]);
        if list.is_empty() {
            ports.push(ContainerPort {
                container: container.to_string(),
                proto: proto.to_string(),
                host_ip: String::new(),
                host_port: String::new(),
            });
        } else {
            for b in list {
                ports.push(ContainerPort {
                    container: container.to_string(),
                    proto: proto.to_string(),
                    host_ip: b["HostIp"].as_str().unwrap_or_default().to_string(),
                    host_port: b["HostPort"].as_str().unwrap_or_default().to_string(),
                });
            }
        }
    };
    if let Some(map) = c["NetworkSettings"]["Ports"].as_object() {
        for (key, val) in map {
            push(key, val.as_array(), &mut ports);
        }
    }
    if let Some(map) = c["Config"]["ExposedPorts"].as_object() {
        for key in map.keys() {
            push(key, None, &mut ports);
        }
    }
    ports.sort_by(|a, b| {
        let num = |p: &ContainerPort| p.container.split('-').next().unwrap_or("").parse::<u32>().unwrap_or(0);
        num(a).cmp(&num(b)).then_with(|| a.proto.cmp(&b.proto)).then_with(|| a.host_port.cmp(&b.host_port))
    });

    let health_test = arg_list(&["Config", "Healthcheck", "Test"]).join(" ");
    let health_log = c["State"]["Health"]["Log"]
        .as_array()
        .map(|a| {
            a.iter()
                .rev()
                .take(5)
                .rev()
                .map(|p| HealthProbe {
                    start: p["Start"].as_str().unwrap_or_default().to_string(),
                    exit_code: p["ExitCode"].as_i64().unwrap_or(0),
                    output: p["Output"].as_str().unwrap_or_default().trim().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let entrypoint = arg_list(&["Config", "Entrypoint"]).join(" ");
    let cmd = arg_list(&["Config", "Cmd"]).join(" ");

    Ok(ContainerDetail {
        id: text("Id").chars().take(12).collect(),
        name: text("Name").trim_start_matches('/').to_string(),
        image: c["Config"]["Image"].as_str().unwrap_or_default().to_string(),
        image_id: c["Image"].as_str().unwrap_or_default().chars().skip(7).take(12).collect(),
        command,
        created: text("Created"),
        started_at: c["State"]["StartedAt"].as_str().unwrap_or_default().to_string(),
        finished_at: c["State"]["FinishedAt"].as_str().unwrap_or_default().to_string(),
        state: c["State"]["Status"].as_str().unwrap_or_default().to_string(),
        health: c["State"]["Health"]["Status"].as_str().unwrap_or_default().to_string(),
        restart_policy: c["HostConfig"]["RestartPolicy"]["Name"].as_str().unwrap_or_default().to_string(),
        restart_count: c["RestartCount"].as_u64().unwrap_or(0),
        restart_max: c["HostConfig"]["RestartPolicy"]["MaximumRetryCount"].as_u64().unwrap_or(0),
        mounts,
        networks,
        env_count: env.len(),
        env,
        labels,
        ports,
        hostname: c["Config"]["Hostname"].as_str().unwrap_or_default().to_string(),
        workdir: c["Config"]["WorkingDir"].as_str().unwrap_or_default().to_string(),
        user: c["Config"]["User"].as_str().unwrap_or_default().to_string(),
        entrypoint,
        cmd,
        health_test,
        health_interval: c["Config"]["Healthcheck"]["Interval"].as_u64().unwrap_or(0),
        health_timeout: c["Config"]["Healthcheck"]["Timeout"].as_u64().unwrap_or(0),
        health_retries: c["Config"]["Healthcheck"]["Retries"].as_u64().unwrap_or(0),
        health_log,
        memory_limit: c["HostConfig"]["Memory"].as_u64().unwrap_or(0),
        nano_cpus: c["HostConfig"]["NanoCpus"].as_i64().unwrap_or(0),
        pid: c["State"]["Pid"].as_i64().unwrap_or(0),
        oom_killed: c["State"]["OOMKilled"].as_bool().unwrap_or(false),
    })
}

#[derive(Serialize, Clone)]
pub struct ImageLayer {
    pub created: String,
    pub size: String,
    pub command: String,
}

#[derive(Serialize, Clone)]
pub struct ImageDetail {
    pub id: String,
    pub tags: Vec<String>,
    pub digests: Vec<String>,
    pub size: u64,
    pub created: String,
    pub architecture: String,
    pub os: String,
    pub author: String,
    pub entrypoint: String,
    pub cmd: String,
    pub workdir: String,
    pub user: String,
    pub env_count: usize,
    pub env: Vec<(String, String)>,
    pub labels: Vec<(String, String)>,
    pub exposed_ports: Vec<String>,
    pub volumes: Vec<String>,
    pub layers: usize,
    /// Local build history, newest first. Empty when the client cannot report it.
    pub history: Vec<ImageLayer>,
}

/// `image history` is not available on every client (nerdctl formatting differs), so a
/// failure yields an empty list rather than failing the whole asset view.
fn image_history(id: &str) -> Vec<ImageLayer> {
    let Ok(raw) = run_docker(&[
        "image", "history", "--no-trunc", "--format",
        "{{.CreatedSince}}\t{{.Size}}\t{{.CreatedBy}}", id,
    ]) else {
        return Vec::new();
    };
    raw.lines()
        .filter_map(|line| {
            let mut f = line.splitn(3, '\t');
            let created = f.next()?.trim().to_string();
            let size = f.next()?.trim().to_string();
            let command = f.next().unwrap_or_default().trim().to_string();
            Some(ImageLayer { created, size, command })
        })
        .take(40)
        .collect()
}

pub fn image_detail(id: &str) -> Result<ImageDetail, String> {
    let raw = run_docker(&["image", "inspect", id])?;
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse image inspect: {e}"))?;
    let img = parsed.first().ok_or("image not found")?;
    let strings = |v: &serde_json::Value| -> Vec<String> {
        v.as_array()
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default()
    };
    let joined = |v: &serde_json::Value| strings(v).join(" ");
    let env: Vec<(String, String)> = img["Config"]["Env"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|s| s.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let mut labels: Vec<(String, String)> = img["Config"]["Labels"]
        .as_object()
        .map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect())
        .unwrap_or_default();
    labels.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(ImageDetail {
        id: img["Id"].as_str().unwrap_or_default().chars().skip(7).take(12).collect(),
        tags: strings(&img["RepoTags"]),
        digests: strings(&img["RepoDigests"]),
        size: img["Size"].as_u64().unwrap_or(0),
        created: img["Created"].as_str().unwrap_or_default().to_string(),
        architecture: img["Architecture"].as_str().unwrap_or_default().to_string(),
        os: img["Os"].as_str().unwrap_or_default().to_string(),
        author: img["Author"].as_str().unwrap_or_default().to_string(),
        entrypoint: joined(&img["Config"]["Entrypoint"]),
        cmd: joined(&img["Config"]["Cmd"]),
        workdir: img["Config"]["WorkingDir"].as_str().unwrap_or_default().to_string(),
        user: img["Config"]["User"].as_str().unwrap_or_default().to_string(),
        env_count: env.len(),
        env,
        labels,
        exposed_ports: {
            let mut ports: Vec<String> = img["Config"]["ExposedPorts"]
                .as_object()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            ports.sort();
            ports
        },
        volumes: {
            let mut vols: Vec<String> = img["Config"]["Volumes"]
                .as_object()
                .map(|m| m.keys().cloned().collect())
                .unwrap_or_default();
            vols.sort();
            vols
        },
        layers: img["RootFS"]["Layers"].as_array().map(|a| a.len()).unwrap_or(0),
        history: image_history(id),
    })
}

#[derive(Serialize, Clone)]
pub struct VolumeDetail {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created: String,
    pub scope: String,
    pub labels: Vec<(String, String)>,
    pub options: Vec<(String, String)>,
    /// `None` when the client cannot report sizes for volumes.
    pub size: Option<u64>,
}

/// Volume sizes only exist in `system df -v`, so read them once and match by name.
fn volume_size(name: &str) -> Option<u64> {
    volume_sizes().into_iter().find(|v| v.name == name).map(|v| v.size)
}

pub fn volume_detail(name: &str) -> Result<VolumeDetail, String> {
    let raw = run_docker(&["volume", "inspect", name])?;
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse volume inspect: {e}"))?;
    let v = parsed.first().ok_or("volume not found")?;
    let pairs = |val: &serde_json::Value| -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = val
            .as_object()
            .map(|m| m.iter().map(|(k, x)| (k.clone(), x.as_str().unwrap_or_default().to_string())).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    };
    Ok(VolumeDetail {
        name: v["Name"].as_str().unwrap_or_default().to_string(),
        driver: v["Driver"].as_str().unwrap_or_default().to_string(),
        mountpoint: v["Mountpoint"].as_str().unwrap_or_default().to_string(),
        created: v["CreatedAt"].as_str().unwrap_or_default().to_string(),
        scope: v["Scope"].as_str().unwrap_or_default().to_string(),
        labels: pairs(&v["Labels"]),
        options: pairs(&v["Options"]),
        size: volume_size(name),
    })
}

#[derive(Serialize, Clone)]
pub struct NetworkMember {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub ipv6: String,
    pub mac: String,
}

#[derive(Serialize, Clone)]
pub struct NetworkDetail {
    pub id: String,
    pub name: String,
    pub driver: String,
    pub scope: String,
    pub created: String,
    pub internal: bool,
    pub enable_ipv6: bool,
    pub subnet: String,
    pub gateway: String,
    pub ip_range: String,
    pub labels: Vec<(String, String)>,
    pub options: Vec<(String, String)>,
    pub containers: Vec<NetworkMember>,
}

pub fn network_detail(name: &str) -> Result<NetworkDetail, String> {
    let raw = run_docker(&["network", "inspect", name])?;
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse network inspect: {e}"))?;
    let net = parsed.first().ok_or("network not found")?;
    let pairs = |val: &serde_json::Value| -> Vec<(String, String)> {
        let mut out: Vec<(String, String)> = val
            .as_object()
            .map(|m| m.iter().map(|(k, x)| (k.clone(), x.as_str().unwrap_or_default().to_string())).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    };
    let mut containers: Vec<NetworkMember> = net["Containers"]
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(id, c)| NetworkMember {
                    id: id.clone(),
                    name: c["Name"].as_str().unwrap_or_default().to_string(),
                    ip: c["IPv4Address"].as_str().unwrap_or_default().to_string(),
                    ipv6: c["IPv6Address"].as_str().unwrap_or_default().to_string(),
                    mac: c["MacAddress"].as_str().unwrap_or_default().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    containers.sort_by(|a, b| a.name.cmp(&b.name));
    let ipam = net["IPAM"]["Config"].as_array().and_then(|a| a.first());
    Ok(NetworkDetail {
        id: net["Id"].as_str().unwrap_or_default().chars().take(12).collect(),
        name: net["Name"].as_str().unwrap_or_default().to_string(),
        driver: net["Driver"].as_str().unwrap_or_default().to_string(),
        scope: net["Scope"].as_str().unwrap_or_default().to_string(),
        created: net["Created"].as_str().unwrap_or_default().to_string(),
        internal: net["Internal"].as_bool().unwrap_or(false),
        enable_ipv6: net["EnableIPv6"].as_bool().unwrap_or(false),
        subnet: ipam.and_then(|c| c["Subnet"].as_str()).unwrap_or_default().to_string(),
        gateway: ipam.and_then(|c| c["Gateway"].as_str()).unwrap_or_default().to_string(),
        ip_range: ipam.and_then(|c| c["IPRange"].as_str()).unwrap_or_default().to_string(),
        labels: pairs(&net["Labels"]),
        options: pairs(&net["Options"]),
        containers,
    })
}




