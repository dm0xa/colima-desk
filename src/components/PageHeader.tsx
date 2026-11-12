import type { ReactNode } from "react";
import { ChevronLeftIcon } from "./icons";
import { RefreshIcon } from "./RefreshIcon";
import { PageSearch } from "./PageSearch";
import type { GlobalIndex, SearchAction } from "../lib/globalSearch";

export type PageActionOption = {
  id: string;
  icon: ReactNode;
  label: string;
  pressed: boolean;
  onClick: () => void;
};

export type PageAction =
  | {
      id: string;
      icon: ReactNode;
      /** Accessible name and tooltip; an icon alone must still say what it does. */
      label: string;
      onClick: () => void;
      disabled?: boolean;
      /** Toggle state, announced with aria-pressed. */
      pressed?: boolean;
      /** Shows the icon as a spinner while its own work runs. */
      busy?: boolean;
      kind?: "button";
    }
  /** Two views of the same page, drawn as one segmented control. */
  | { id: string; kind: "switch"; label: string; options: PageActionOption[] };

type Props = {
  title: string;
  back?: { label: string; onClick: () => void };
  /** A page's own filter; absent on pages where only global search applies. */
  page?: { value: string; onChange: (next: string) => void; placeholder: string; label: string };
  defaultScope?: "page" | "global";
  index: GlobalIndex;
  onSearchAction: (action: SearchAction) => void;
  actions?: PageAction[];
  onRefresh: () => void;
  refreshing: boolean;
};

/**
 * The one header every screen renders: title and back on the left, search then the
 * page's own actions then Refresh on the right. Page-wide actions belong here; a
 * control that changes one panel stays in that panel's header.
 */
export function PageHeader({ title, back, page, defaultScope, index, onSearchAction, actions = [], onRefresh, refreshing }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-head">
        {back && (
          <button className="icon-plain topbar-back" onClick={back.onClick} aria-label={`Back to ${back.label}`} title={`Back to ${back.label} (⌘[)`}>
            <ChevronLeftIcon size={17} />
          </button>
        )}
        <h1>{title}</h1>
      </div>
      <div className="topbar-tools">
        <PageSearch page={page} index={index} onAction={onSearchAction} defaultScope={defaultScope} />
        {actions.map((action) => action.kind === "switch" ? (
          <div key={action.id} className="view-switch" role="group" aria-label={action.label}>
            {action.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={option.pressed ? "on" : ""}
                aria-label={option.label}
                aria-pressed={option.pressed}
                title={option.label}
                onClick={option.onClick}
              >
                {option.icon}
              </button>
            ))}
          </div>
        ) : (
          <button
            key={action.id}
            className={`icon-plain ${action.pressed ? "active" : ""}`}
            aria-label={action.label}
            aria-pressed={action.pressed}
            title={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.busy ? <RefreshIcon spinning /> : action.icon}
          </button>
        ))}
        <button className="icon-plain" onClick={onRefresh} disabled={refreshing} aria-label="Refresh" title="Refresh (⌘R)">
          <RefreshIcon spinning={refreshing} />
        </button>
      </div>
    </div>
  );
}
