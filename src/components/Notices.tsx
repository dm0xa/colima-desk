export type NoticeKind = "error" | "success" | "info";

export type Notice = {
  id: number;
  kind: NoticeKind;
  title: string;
  detail?: string;
  /** Docker container this notice is about, so related actions can clear it. */
  containerId?: string;
  /** Contextual actions, e.g. reveal the container blocking an image delete. */
  actions?: { label: string; run: () => void }[];
};

export function Notices({ notices, onDismiss }: {
  notices: Notice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) return null;
  return (
    <div className="notices">
      {notices.map((n) => (
        <div key={n.id} className={`notice-card ${n.kind}`} role={n.kind === "error" ? "alert" : "status"}>
          <div className="notice-body">
            <div className="notice-title">{n.title}</div>
            {n.detail && <div className="notice-detail">{n.detail}</div>}
            {n.actions && n.actions.length > 0 && (
              <div className="notice-actions">
                {n.actions.map((a) => (
                  <button key={a.label} className="btn ghost" onClick={a.run}>{a.label}</button>
                ))}
              </div>
            )}
          </div>
          <button className="notice-close" aria-label="Dismiss" title="Dismiss" onClick={() => onDismiss(n.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
