import { kpiCard } from "../kpi";

const ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5h5v5h-5z" /></svg>;

export default kpiCard({
  label: "Stopped VMs",
  description: "Profiles that are stopped",
  icon: ICON,
  value: (c) => c.profiles.length - c.running.length,
  tab: "runtimes",
  tabLabel: "Machine",
  order: 30,
});
