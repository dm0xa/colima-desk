import type { DashboardCard, DashboardWidget, WidgetVisibility } from "./context";

/** Bump when the default dashboard composition changes so persisted layouts reset. */
export const LAYOUT_VERSION = 2;

/**
 * Cards are discovered from `cards/`, one file per card. The filename is the key, so it is
 * the value stored in `localStorage`; renaming a file resets that card's saved state.
 * Dropping a file in the folder is the whole registration step — there is no list to edit.
 */
const modules = import.meta.glob<{ default: DashboardCard }>("./cards/*.tsx", { eager: true });

function keyFromPath(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1);
  return file.replace(/\.tsx$/, "");
}

export type WidgetKey = string;

export const DASHBOARD_WIDGETS: DashboardWidget[] = Object.entries(modules)
  .map(([path, mod]) => ({ ...mod.default, key: keyFromPath(path) }))
  .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

export const WIDGET_KEYS: WidgetKey[] = DASHBOARD_WIDGETS.map((w) => w.key);

export const DEFAULT_WIDGETS: WidgetVisibility = Object.fromEntries(
  DASHBOARD_WIDGETS.map((w) => [w.key, w.defaultVisible ?? true]),
);

export function widgetLabel(key: WidgetKey): string {
  return DASHBOARD_WIDGETS.find((w) => w.key === key)?.label ?? key;
}
