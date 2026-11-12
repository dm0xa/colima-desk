export type Profile = {
  name: string;
  status: string;
  arch?: string;
  cpus?: number;
  memory?: number;
  disk?: number;
  runtime?: string;
};

export type Status = {
  runtime?: string;
  arch?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  docker_socket?: string;
  containerd_socket?: string;
  kubernetes?: boolean;
  mount_type?: string;
  driver?: string;
};

export type Container = {
  id: string;
  mounts: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  created_at: string;
  state: string;
  pod_name: string;
  pod_namespace: string;
  compose_project: string;
};

export type Image = { id: string; repository: string; tag: string; size: string; created: string };
export type Volume = { name: string; driver: string; mountpoint: string };
export type Network = { name: string; driver: string; scope: string };
export type SystemStatus = {
  colima: boolean;
  docker: boolean;
  kubectl: boolean;
  lima: boolean;
  kind: boolean;
  nerdctl: boolean;
  compose: boolean;
  ramalama: boolean;
  krunkit: boolean;
};
export type ComposeProject = { name: string; status: string };
export type ImageDetail = {
  id: string;
  tags: string[];
  digests: string[];
  size: number;
  created: string;
  architecture: string;
  os: string;
  author: string;
  entrypoint: string;
  cmd: string;
  workdir: string;
  user: string;
  env_count: number;
  env: [string, string][];
  labels: [string, string][];
  exposed_ports: string[];
  volumes: string[];
  layers: number;
  history: { created: string; size: string; command: string }[];
};
export type VolumeDetail = {
  name: string;
  driver: string;
  mountpoint: string;
  created: string;
  scope: string;
  labels: [string, string][];
  options: [string, string][];
  size: number | null;
};
export type VolumeSize = { name: string; size: number };
export type VolumeEntryKind = "dir" | "file" | "link" | "char" | "block" | "pipe" | "socket" | "other";
export type VolumeEntry = {
  kind: VolumeEntryKind;
  name: string;
  size: number;
  modified: string;
  user: string;
  group: string;
  mode: string;
  link: string;
};
export type VolumeContents = {
  root: string;
  path: string;
  entries: VolumeEntry[];
  truncated: boolean;
};
export type ContainerStat = {
  id: string;
  name: string;
  cpu: number;
  mem: number;
  mem_limit: number;
  mem_pct: number;
  pids: number;
  net_rx: number;
  net_tx: number;
  block_read: number;
  block_write: number;
};
export type ContainerMount = { source: string; destination: string; mode: string; kind: string };
export type ContainerNet = { name: string; ip: string; ipv6: string; mac: string; gateway: string };
export type ContainerPort = { container: string; proto: string; host_ip: string; host_port: string };
export type HealthProbe = { start: string; exit_code: number; output: string };
export type ContainerDetail = {
  id: string;
  name: string;
  image: string;
  image_id: string;
  command: string;
  created: string;
  started_at: string;
  finished_at: string;
  state: string;
  health: string;
  restart_policy: string;
  restart_count: number;
  restart_max: number;
  mounts: ContainerMount[];
  networks: ContainerNet[];
  env_count: number;
  env: [string, string][];
  labels: [string, string][];
  ports: ContainerPort[];
  hostname: string;
  workdir: string;
  user: string;
  entrypoint: string;
  cmd: string;
  health_test: string;
  health_interval: number;
  health_timeout: number;
  health_retries: number;
  health_log: HealthProbe[];
  memory_limit: number;
  nano_cpus: number;
  pid: number;
  oom_killed: boolean;
};
export type NetworkContainer = { name: string; ip: string; mac: string };
export type NetworkMapEntry = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string;
  gateway: string;
  containers: NetworkContainer[];
};
export type NetworkMember = { id: string; name: string; ip: string; ipv6: string; mac: string };
export type NetworkDetail = {
  id: string;
  name: string;
  driver: string;
  scope: string;
  created: string;
  internal: boolean;
  enable_ipv6: boolean;
  subnet: string;
  gateway: string;
  ip_range: string;
  labels: [string, string][];
  options: [string, string][];
  containers: NetworkMember[];
};
export type LimaVm = { name: string; status: string };
export type VmDiagnostics = {
  ok: boolean;
  error: string | null;
  kernel: string;
  uptime_seconds: number;
  cpus: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total: number;
  mem_available: number;
  swap_total: number;
  swap_free: number;
  root_total: number;
  root_used: number;
  inodes_total: number;
  inodes_used: number;
  docker_active: boolean;
  oom_kills: number;
};

export type VersionInfo = {
  installed: string;
  latest: string | null;
  manager: string;
  update_available: boolean;
};

/** Newest Colima Desk release, checked against the version this build carries. */
export type AppRelease = {
  installed: string;
  latest: string | null;
  update_available: boolean;
  url: string;
};

export type Counts = { containers: number; running: number; images: number; volumes: number };
export type DiskUsage = { images: number; containers: number; volumes: number; build_cache: number; reclaimable: number };
export type CleanupImage = {
  id: string;
  tags: string[];
  size: number;
  unique: number;
  containers: number;
  created: string;
  age_days: number | null;
  dangling: boolean;
};
export type CleanupContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  running: boolean;
  status: string;
  size: number;
  running_for: string;
  created: string;
  age_days: number | null;
};
export type CleanupVolume = { name: string; driver: string; mountpoint: string; size: number; links: number; created: string; age_days: number | null };
export type CleanupCacheEntry = { size: number; kind: string; last_used: string; in_use: boolean };
export type CleanupLogFile = { container: string; path: string; size: number };
export type CleanupReport = {
  totals: DiskUsage;
  images: CleanupImage[];
  containers: CleanupContainer[];
  volumes: CleanupVolume[];
  build_cache: CleanupCacheEntry[];
  client: string;
  host_disk: number;
  host_disk_path: string;
  root_total: number;
  root_used: number;
  docker_dir: number;
  log_files: CleanupLogFile[];
  error: string | null;
};
export type ProfileConfig = {
  vm_type: string;
  runtime: string;
  arch: string;
  mount_type: string;
  cpu: number;
  memory: number;
  disk: number;
  rosetta: boolean;
};
