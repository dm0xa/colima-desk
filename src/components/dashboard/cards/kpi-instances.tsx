import { kpiCard } from "../kpi";

const ICON = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></svg>;

export default kpiCard({
  label: "VM Instances",
  description: "Colima profiles",
  icon: ICON,
  value: (c) => c.profiles.length,
  tab: "runtimes",
  tabLabel: "Machine",
  order: 10,
});
