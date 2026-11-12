//! Storage report for the Cleanup page: what Docker holds, what nothing uses, and what
//! the VM's disk image costs on the host.
//!
//! Two sources answer two different questions. `docker system df -v` reports logical
//! sizes Docker accounts for (layers shared between images counted once per image) and
//! which images, volumes and containers are in use. `colima ssh` reports what actually
//! sits on the guest's disk, including container log files, which Docker's totals skip.

use serde::Serialize;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::colima;
use crate::docker::{self, parse_size};

#[derive(Serialize, Clone, Default)]
pub struct CleanupImage {
    /// Full image ID. Two tags on one image collapse into one row, so a removal by ID
    /// deletes every tag it found and size sums never count the image twice.
    pub id: String,
    pub tags: Vec<String>,
    pub size: u64,
    /// Bytes only this image holds; the honest saving when it goes away.
    pub unique: u64,
    pub containers: u64,
    pub created: String,
    pub age_days: Option<u64>,
    pub dangling: bool,
}

#[derive(Serialize, Clone, Default)]
pub struct CleanupContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    /// `State` is absent from nerdctl's verbose output, so running is derived from `Status`.
    pub running: bool,
    pub status: String,
    pub size: u64,
    pub running_for: String,
    /// Docker's `CreatedAt`; nerdctl reports no container timestamp, so it stays empty.
    pub created: String,
    pub age_days: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
pub struct CleanupVolume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub size: u64,
    /// Containers mounting the volume. 0 means `docker volume prune` would take it.
    pub links: u64,
    /// RFC 3339 from `volume inspect`; `system df -v` carries no volume timestamps.
    pub created: String,
    pub age_days: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
pub struct CleanupCacheEntry {
    pub size: u64,
    pub kind: String,
    pub last_used: String,
    pub in_use: bool,
}

#[derive(Serialize, Clone, Default)]
pub struct CleanupLogFile {
    /// Container that writes the log; the short ID when its row is gone.
    pub container: String,
    pub path: String,
    pub size: u64,
}

#[derive(Serialize, Clone, Default)]
pub struct CleanupReport {
    pub totals: docker::DiskUsage,
    pub images: Vec<CleanupImage>,
    pub containers: Vec<CleanupContainer>,
    pub volumes: Vec<CleanupVolume>,
    pub build_cache: Vec<CleanupCacheEntry>,
    /// Client that answered: `nerdctl` on containerd profiles, `docker` on the Docker
    /// runtime or as the fallback.
    pub client: String,
    /// Bytes the sparse disk image occupies on the host, and its path.
    pub host_disk: u64,
    pub host_disk_path: String,
    pub root_total: u64,
    pub root_used: u64,
    /// `du` of /var/lib/docker in the guest: what the layers cost on disk, not Docker's
    /// logical sum.
    pub docker_dir: u64,
    pub log_files: Vec<CleanupLogFile>,
    /// A `system df -v` failure (daemon down, client without the verbose format).
    pub error: Option<String>,
}

/// `du` walks allocated blocks, so it answers "what does this cost the VM disk". Log
/// files are read separately because they live outside the layer accounting.
const GUEST_SCRIPT: &str = r#"df -k / | awk 'NR==2{print "root_total_kb="$2; print "root_used_kb="$3}'
sudo -n du -sk /var/lib/docker 2>/dev/null | awk '{print "docker_kb="$1}'
sudo -n find /var/lib/docker/containers -name '*-json.log' -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -8"#;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((m + 9) % 12) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Docker's `CreatedAt` is `2026-11-11 17:04:47 +0100 CET` (offset plus a zone name);
/// `volume inspect` reports RFC 3339 (`2026-10-22T22:46:57+02:00`), sometimes with
/// fractional seconds. Both are parsed by hand because the app carries no date crate.
/// A zero time (`0001-01-01T00:00:00Z` on nerdctl rows) yields None, so the UI says unknown.
fn parse_epoch(created: &str) -> Option<i64> {
    let stamp = created.trim();
    // The separator is the RFC 3339 `T` at index 10, never the `T` in a zone name like CET.
    let (date, rest) = if stamp.as_bytes().get(10) == Some(&b'T') {
        (&stamp[..10], &stamp[11..])
    } else {
        stamp.split_once(' ')?
    };
    let (time, offset) = match rest.char_indices().find(|(_, c)| *c == '+' || *c == '-') {
        Some((at, _)) => (rest[..at].trim(), &rest[at..]),
        None => (rest.trim(), ""),
    };
    let time = time.strip_suffix('Z').unwrap_or(time);
    let mut d = date.split('-');
    let year: i64 = d.next()?.parse().ok()?;
    // nerdctl reports a missing timestamp as Go's zero time (year 1); that is not a date.
    if year < 1970 {
        return None;
    }
    let month: u32 = d.next()?.parse().ok()?;
    let day: u32 = d.next()?.parse().ok()?;
    let mut t = time.split(':');
    let hour: i64 = t.next()?.parse().ok()?;
    let minute: i64 = t.next()?.parse().ok()?;
    let second: i64 = t.next()?.split('.').next()?.parse().ok()?;
    let offset_secs = if offset.is_empty() {
        0
    } else {
        let digits: String = offset.chars().filter(|c| c.is_ascii_digit()).collect();
        if digits.len() < 4 {
            return None;
        }
        let oh: i64 = digits[..2].parse().ok()?;
        let om: i64 = digits[2..4].parse().ok()?;
        let sign = if offset.starts_with('-') { -1 } else { 1 };
        (oh * 3600 + om * 60) * sign
    };
    Some(days_from_civil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset_secs)
}

fn age_days(created: &str, now: u64) -> Option<u64> {
    let then = parse_epoch(created)?;
    Some((((now as i64) - then).max(0) / 86400) as u64)
}

/// nerdctl's verbose image rows carry `CreatedSince` ("3 weeks ago") and no timestamp, so
/// the age of an image on a containerd profile comes from that phrase.
fn age_from_since(since: &str) -> Option<u64> {
    let lower = since.to_ascii_lowercase();
    let count: u64 = lower.split_whitespace().find_map(|word| word.parse().ok()).unwrap_or(1);
    if lower.contains("second") || lower.contains("minute") || lower.contains("hour") {
        return Some(0);
    }
    if lower.contains("day") {
        return Some(count);
    }
    if lower.contains("week") {
        return Some(count * 7);
    }
    if lower.contains("month") {
        return Some(count * 30);
    }
    if lower.contains("year") {
        return Some(count * 365);
    }
    None
}

fn first_str<'a>(row: &'a serde_json::Value, keys: &[&str]) -> &'a str {
    keys.iter().map(|key| str_field(row, key)).find(|value| !value.is_empty()).unwrap_or("")
}

fn str_field<'a>(row: &'a serde_json::Value, key: &str) -> &'a str {
    row.get(key).and_then(|v| v.as_str()).unwrap_or("")
}

fn u64_field(row: &serde_json::Value, key: &str) -> u64 {
    str_field(row, key).trim().parse().unwrap_or(0)
}

fn size_field(row: &serde_json::Value, key: &str) -> u64 {
    parse_size(str_field(row, key))
}

fn bool_field(row: &serde_json::Value, key: &str) -> bool {
    match row.get(key) {
        Some(serde_json::Value::Bool(b)) => *b,
        Some(serde_json::Value::String(s)) => s == "true",
        _ => false,
    }
}

/// One `system df -v` document: images deduped per ID, containers, volumes and cache rows.
fn parse_df(raw: &str, now: u64) -> (Vec<CleanupImage>, Vec<CleanupContainer>, Vec<CleanupVolume>, Vec<CleanupCacheEntry>) {
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(raw.trim()) else {
        return (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    };
    let rows = |key: &str| doc.get(key).and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let mut by_id: BTreeMap<String, CleanupImage> = BTreeMap::new();
    for row in rows("Images") {
        let id = str_field(&row, "ID").to_string();
        if id.is_empty() {
            continue;
        }
        let repo = str_field(&row, "Repository");
        let tag = str_field(&row, "Tag");
        let created_at = str_field(&row, "CreatedAt");
        let created = if created_at.is_empty() {
            str_field(&row, "CreatedSince").to_string()
        } else {
            created_at.to_string()
        };
        let age = age_days(created_at, now).or_else(|| age_from_since(str_field(&row, "CreatedSince")));
        let entry = by_id.entry(id.clone()).or_insert_with(|| CleanupImage {
            id,
            tags: Vec::new(),
            size: 0,
            unique: 0,
            containers: 0,
            created: created.clone(),
            age_days: age,
            dangling: false,
        });
        if !repo.is_empty() && repo != "<none>" {
            entry.tags.push(format!("{repo}:{tag}"));
        }
        entry.size = entry.size.max(size_field(&row, "Size"));
        entry.unique = entry.unique.max(size_field(&row, "UniqueSize"));
        entry.containers = entry.containers.max(u64_field(&row, "Containers"));
    }
    let mut images: Vec<CleanupImage> = by_id.into_values().collect();
    for image in &mut images {
        image.tags.sort();
        image.dangling = image.tags.is_empty();
    }
    images.sort_by(|a, b| b.size.cmp(&a.size).then_with(|| a.id.cmp(&b.id)));

    let mut containers: Vec<CleanupContainer> = rows("Containers")
        .iter()
        .map(|row| {
            let state = str_field(row, "State").to_string();
            let status = str_field(row, "Status").to_string();
            let created = str_field(row, "CreatedAt").to_string();
            let running = if state.is_empty() {
                status.starts_with("Up ")
            } else {
                state.eq_ignore_ascii_case("running")
            };
            CleanupContainer {
                id: str_field(row, "ID").to_string(),
                name: str_field(row, "Names").to_string(),
                image: str_field(row, "Image").to_string(),
                state,
                running,
                status,
                size: size_field(row, "Size"),
                running_for: str_field(row, "RunningFor").to_string(),
                age_days: age_days(&created, now),
                created,
            }
        })
        .filter(|c| !c.id.is_empty())
        .collect();
    containers.sort_by(|a, b| b.size.cmp(&a.size));

    let mut volumes: Vec<CleanupVolume> = rows("Volumes")
        .iter()
        .map(|row| CleanupVolume {
            name: str_field(row, "Name").to_string(),
            driver: str_field(row, "Driver").to_string(),
            mountpoint: str_field(row, "Mountpoint").to_string(),
            size: size_field(row, "Size"),
            links: u64_field(row, "Links"),
            ..Default::default()
        })
        .filter(|v| !v.name.is_empty())
        .collect();
    volumes.sort_by(|a, b| b.size.cmp(&a.size));

    let mut build_cache: Vec<CleanupCacheEntry> = rows("BuildCache")
        .iter()
        .map(|row| CleanupCacheEntry {
            size: size_field(row, "Size"),
            kind: first_str(row, &["Type", "CacheType"]).to_string(),
            last_used: first_str(row, &["LastUsedAt", "LastUsedSince"]).to_string(),
            in_use: bool_field(row, "InUse"),
        })
        .collect();
    build_cache.sort_by(|a, b| b.size.cmp(&a.size));

    (images, containers, volumes, build_cache)
}

#[derive(Default)]
struct GuestScan {
    root_total: u64,
    root_used: u64,
    docker_dir: u64,
    logs: Vec<(u64, String)>,
}

/// Guest output is `key=value` lines plus `<bytes>\t<log path>` rows from find.
fn parse_guest(raw: &str) -> GuestScan {
    let mut scan = GuestScan::default();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            match key {
                "root_total_kb" => scan.root_total = value.trim().parse::<u64>().unwrap_or(0) * 1024,
                "root_used_kb" => scan.root_used = value.trim().parse::<u64>().unwrap_or(0) * 1024,
                "docker_kb" => scan.docker_dir = value.trim().parse::<u64>().unwrap_or(0) * 1024,
                _ => {}
            }
            continue;
        }
        if let Some((size, path)) = line.split_once('\t') {
            if let Ok(size) = size.trim().parse::<u64>() {
                scan.logs.push((size, path.trim().to_string()));
            }
        }
    }
    scan
}

/// Container ID segment of `/var/lib/docker/containers/<id>/<id>-json.log`.
fn container_id_from_log(path: &str) -> Option<&str> {
    let rest = path.split("/containers/").nth(1)?;
    Some(rest.split('/').next().unwrap_or(rest))
}

fn parse_report(df: &str, guest: &str, now: u64) -> CleanupReport {
    let (images, containers, volumes, build_cache) = parse_df(df, now);
    let scan = parse_guest(guest);
    let log_files = scan
        .logs
        .iter()
        .map(|(size, path)| {
            let id = container_id_from_log(path).unwrap_or("");
            let name = containers
                .iter()
                .find(|c| !c.id.is_empty() && (c.id.starts_with(id) || id.starts_with(&c.id[..c.id.len().min(12)])))
                .map(|c| c.name.clone())
                .unwrap_or_else(|| id.chars().take(12).collect());
            CleanupLogFile { container: name, path: path.clone(), size: *size }
        })
        .collect();
    CleanupReport {
        images,
        containers,
        volumes,
        build_cache,
        root_total: scan.root_total,
        root_used: scan.root_used,
        docker_dir: scan.docker_dir,
        log_files,
        ..Default::default()
    }
}

/// `system df -v` through the profile's client, nerdctl first with the Docker CLI as one
/// fallback attempt (see `docker::run_client`); the label names the client that answered.
fn run_df() -> (Result<String, String>, &'static str) {
    docker::run_client(&["system", "df", "-v", "--format", "{{json .}}"])
}

/// `system df -v` has no volume timestamps, so one batched `volume inspect` supplies the
/// creation time for every volume in the report. A client that cannot answer (older
/// nerdctl, a volume that vanished mid-scan) leaves the fields empty, and the row says unknown.
fn annotate_volume_created(volumes: &mut [CleanupVolume], now: u64) {
    let mut args = vec!["volume", "inspect", "--format", "{{.Name}}|{{.CreatedAt}}"];
    args.extend(volumes.iter().map(|v| v.name.as_str()));
    let Ok(raw) = docker::run_client(&args).0 else { return };
    let stamps: BTreeMap<&str, &str> = raw
        .lines()
        .filter_map(|line| line.split_once('|'))
        .map(|(name, created)| (name.trim(), created.trim()))
        .collect();
    for volume in volumes.iter_mut() {
        let Some(created) = stamps.get(volume.name.as_str()) else { continue };
        volume.created = created.to_string();
        volume.age_days = age_days(created, now);
    }
}

/// Report for the selected profile. The Docker scan, the guest scan and the host disk
/// stat are independent processes, so they run together: the guest `du` costs ~3 s.
pub fn report(profile: &str) -> CleanupReport {
    let now = now_secs();
    let (df, guest, host) = std::thread::scope(|scope| {
        let df = scope.spawn(run_df);
        let guest = scope.spawn(|| colima::ssh_script(profile, GUEST_SCRIPT));
        let host = scope.spawn(move || colima::disk_image(profile));
        (
            df.join().unwrap_or_else(|_| (Err("cleanup scan failed".to_string()), "docker")),
            guest.join().unwrap_or_else(|_| Err("virtual machine scan failed".to_string())),
            host.join().unwrap_or_else(|_| (String::new(), 0)),
        )
    });
    let (df, client) = df;
    let mut report = match &df {
        Ok(raw) => parse_report(raw, guest.as_deref().unwrap_or(""), now),
        Err(e) => CleanupReport { error: Some(e.clone()), ..Default::default() },
    };
    if !report.volumes.is_empty() {
        annotate_volume_created(&mut report.volumes, now);
    }
    report.totals = docker::disk_usage();
    report.client = client.to_string();
    report.host_disk = host.1;
    report.host_disk_path = host.0;
    if df.is_err() {
        // Still show the guest and host numbers: they explain a full disk even when the
        // daemon is not answering.
        let scan = parse_guest(guest.as_deref().unwrap_or(""));
        report.root_total = scan.root_total;
        report.root_used = scan.root_used;
        report.docker_dir = scan.docker_dir;
        report.log_files = scan
            .logs
            .iter()
            .map(|(size, path)| CleanupLogFile {
                container: container_id_from_log(path).map(|id| id.chars().take(12).collect()).unwrap_or_default(),
                path: path.clone(),
                size: *size,
            })
            .collect();
    }
    report
}

#[cfg(test)]
mod tests {
    use super::{age_days, parse_df, parse_epoch, parse_guest, parse_report, CleanupReport};

    const DF: &str = r#"{"Images":[
{"Containers":"0","CreatedAt":"2026-11-11 17:04:47 +0100 CET","ID":"sha256:aaa","Repository":"app","SharedSize":"206.1MB","Size":"986MB","Tag":"local","UniqueSize":"780MB"},
{"Containers":"0","CreatedAt":"2026-11-11 17:04:47 +0100 CET","ID":"sha256:aaa","Repository":"app","SharedSize":"206.1MB","Size":"986MB","Tag":"v2","UniqueSize":"780MB"},
{"Containers":"1","CreatedAt":"2026-10-01 09:00:00 +0100 CEST","ID":"sha256:bbb","Repository":"\u003cnone\u003e","SharedSize":"835.6MB","Size":"840MB","Tag":"\u003cnone\u003e","UniqueSize":"4.45MB"},
{"Containers":"1","CreatedAt":"2026-10-01 09:00:00 +0100 CEST","ID":"sha256:ccc","Repository":"base","SharedSize":"0B","Size":"840MB","Tag":"latest","UniqueSize":"0B"}
],"Containers":[
{"ID":"81ce1d7b97731665754328544fdfc1c436be019dcb8295faa5eb17e651592ed5","Names":"web","Image":"base:latest","State":"exited","Status":"Exited (0)","Size":"4.1kB","RunningFor":"2 days ago","CreatedAt":"2026-11-10 09:00:00 +0100 CET"},
{"ID":"300dc36d7982461feb3725193a14975f50ca3a74761ce8afc4935f8e81b18664","Names":"api","Image":"app:local","State":"running","Status":"Up 3 hours","Size":"1.2MB","RunningFor":"3 hours ago"}
],"Volumes":[
{"Driver":"local","Links":"0","Mountpoint":"/var/lib/docker/volumes/old/_data","Name":"old","Size":"71.96MB"},
{"Driver":"local","Links":"1","Mountpoint":"/var/lib/docker/volumes/data/_data","Name":"data","Size":"2MB"}
],"BuildCache":[]}"#;

    const GUEST: &str = "root_total_kb=19221248\nroot_used_kb=1468788\ndocker_kb=1199304\n7101071\t/var/lib/docker/containers/300dc36d7982461feb3725193a14975f50ca3a74761ce8afc4935f8e81b18664/300dc36d7982461feb3725193a14975f50ca3a74761ce8afc4935f8e81b18664-json.log\n17771\t/var/lib/docker/containers/81ce1d7b97731665754328544fdfc1c436be019dcb8295faa5eb17e651592ed5/81ce1d7b97731665754328544fdfc1c436be019dcb8295faa5eb17e651592ed5-json.log\n";

    #[test]
    fn images_collapse_per_id_and_flag_dangling() {
        let r = parse_report(DF, GUEST, 1_800_000_000);
        assert_eq!(r.images.len(), 3);
        let app = r.images.iter().find(|i| i.id == "sha256:aaa").expect("app image");
        assert_eq!(app.tags, vec!["app:local", "app:v2"]);
        assert_eq!(app.size, 986_000_000);
        assert_eq!(app.unique, 780_000_000);
        assert!(!app.dangling);
        let dangling = r.images.iter().find(|i| i.id == "sha256:bbb").expect("untagged image");
        assert!(dangling.dangling);
        assert!(dangling.tags.is_empty());
        assert_eq!(dangling.containers, 1);
    }

    /// nerdctl's verbose rows use their own keys: `CreatedSince`, `CacheType`,
    /// `LastUsedSince`, and `InUse` as a string. No `CreatedAt`, no container `State`.
    const NERDCTL_DF: &str = r#"{"Images":[
{"Containers":"0","CreatedSince":"3 weeks ago","ID":"sha256:aaa","Repository":"app","SharedSize":"1.2GB","Size":"2.1GB","Tag":"local","UniqueSize":"900MB"}
],"Containers":[
{"Command":"\"/entrypoint.sh\"","ID":"abc","Image":"app:local","LocalVolumes":"0","Names":"web","RunningFor":"3 hours ago","Size":"1.2MB","Status":"Up 3 hours"},
{"Command":"\"true\"","ID":"def","Image":"app:local","LocalVolumes":"0","Names":"batch","RunningFor":"2 days ago","Size":"4.1kB","Status":"Exited (0) 2 days ago"}
],"Volumes":[{"Links":"0","Name":"data","Size":"12MB"}],
"BuildCache":[{"CacheType":"regular","CreatedSince":"2 hours ago","ID":"x","InUse":"true","LastUsedSince":"1 hour ago","Shared":"false","Size":"5MB","UsageCount":"2"}]}"#;

    #[test]
    fn nerdctl_rows_use_their_own_field_names() {
        let (images, containers, volumes, cache) = parse_df(NERDCTL_DF, 1_800_000_000);
        assert_eq!(images[0].age_days, Some(21));
        assert_eq!(images[0].created, "3 weeks ago");
        assert!(containers.iter().find(|c| c.name == "web").is_some_and(|c| c.running));
        assert!(containers.iter().find(|c| c.name == "batch").is_some_and(|c| !c.running));
        assert_eq!(volumes[0].links, 0);
        assert_eq!(cache[0].kind, "regular");
        assert_eq!(cache[0].last_used, "1 hour ago");
        assert!(cache[0].in_use);
    }

    #[test]
    fn ages_come_from_since_phrases() {
        assert_eq!(super::age_from_since("Less than a second ago"), Some(0));
        assert_eq!(super::age_from_since("About an hour ago"), Some(0));
        assert_eq!(super::age_from_since("2 days ago"), Some(2));
        assert_eq!(super::age_from_since("5 months ago"), Some(150));
        assert_eq!(super::age_from_since("nonsense"), None);
    }

    #[test]
    fn volumes_and_stopped_containers_keep_their_usage() {
        let r = parse_report(DF, GUEST, 1_800_000_000);
        let old = r.volumes.iter().find(|v| v.name == "old").expect("old volume");
        assert_eq!(old.size, 71_960_000);
        assert_eq!(old.links, 0);
        assert_eq!(r.volumes.iter().find(|v| v.name == "data").map(|v| v.links), Some(1));
        let web = r.containers.iter().find(|c| c.name == "web").expect("web");
        assert_eq!(web.state, "exited");
        assert!(!web.running);
        assert_eq!(web.size, 4_100);
        assert_eq!(web.created, "2026-11-10 09:00:00 +0100 CET");
        assert_eq!(web.age_days, Some(66));
        assert!(r.containers.iter().find(|c| c.name == "api").is_some_and(|c| c.running));
    }

    #[test]
    fn guest_scan_maps_log_files_to_containers() {
        let r = parse_report(DF, GUEST, 1_800_000_000);
        assert_eq!(r.root_total, 19221248 * 1024);
        assert_eq!(r.docker_dir, 1199304 * 1024);
        assert_eq!(r.log_files.len(), 2);
        assert_eq!(r.log_files[0].size, 7_101_071);
        assert_eq!(r.log_files[0].container, "api");
        assert_eq!(r.log_files[1].container, "web");
    }

    #[test]
    fn guest_scan_survives_a_partial_script() {
        let scan = parse_guest("root_total_kb=1024\nbroken=xyz\njunk");
        assert_eq!(scan.root_total, 1024 * 1024);
        assert_eq!(scan.root_used, 0);
        assert!(scan.logs.is_empty());
    }

    #[test]
    fn docker_timestamps_become_ages() {
        // 2026-11-11T16:04:47Z
        assert_eq!(parse_epoch("2026-11-11 17:04:47 +0100 CET"), Some(1_794_413_087));
        assert_eq!(age_days("2026-11-11 17:04:47 +0100 CET", 1_794_413_087 + 3 * 86_400 + 60), Some(3));
        assert_eq!(age_days("2026-11-11 17:04:47 +01:00", 1_794_413_087), Some(0));
        assert_eq!(age_days("not a date", 1_794_413_087), None);
    }

    #[test]
    fn rfc3339_and_fractional_timestamps_parse() {
        // volume inspect: same instant, RFC 3339 with a colon offset.
        assert_eq!(parse_epoch("2026-11-11T17:04:47+01:00"), Some(1_794_413_087));
        assert_eq!(parse_epoch("2026-11-11T16:04:47Z"), Some(1_794_413_087));
        assert_eq!(parse_epoch("2026-11-11T16:04:47.293366991Z"), Some(1_794_413_087));
        assert_eq!(parse_epoch("2026-11-11T11:04:47-05:00"), Some(1_794_413_087));
        // nerdctl's zero time is not a creation date.
        assert_eq!(parse_epoch("0001-01-01T00:00:00Z"), None);
        // A negative offset moves the instant forward in UTC.
        assert_eq!(
            parse_epoch("2026-11-11T11:04:47-05:00").map(|then| then - parse_epoch("2026-11-11T16:04:47Z").unwrap()),
            Some(0)
        );
    }

    #[test]
    fn an_empty_report_serialises_with_defaults() {
        let r = CleanupReport::default();
        let json = serde_json::to_string(&r).expect("serialise");
        assert!(json.contains("\"images\":[]"));
    }

}



