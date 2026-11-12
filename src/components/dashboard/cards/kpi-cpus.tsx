import { kpiCard } from "../kpi";

const ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" /></svg>;

export default kpiCard({
  label: "Allocated vCPUs",
  description: "vCPUs across profiles",
  icon: ICON,
  value: (c) => c.profiles.reduce((sum, p) => sum + (p.cpus ?? 0), 0),
  tab: "runtimes",
  tabLabel: "Machine",
  order: 40,
});
