import { kpiCard } from "../kpi";

const ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>;

export default kpiCard({
  label: "Running VMs",
  description: "Profiles that are running",
  icon: ICON,
  value: (c) => c.running.length,
  state: (c) => c.running.length > 0 ? "ok" : undefined,
  tab: "runtimes",
  tabLabel: "Machine",
  order: 20,
});
