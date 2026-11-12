import type { DashboardContext } from "./context";
import { OriginBadge } from "../../lib/origin";

export function RecentContainers({ containers, setTab, openSubject }: DashboardContext) {
  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Recent containers</h3>
        <button className="btn ghost" onClick={() => setTab("containers")}>View all →</button>
      </div>
      <table className="table table-recent">
        <thead><tr><th>State</th><th>Origin</th><th>Name</th><th>Image</th><th>Status</th></tr></thead>
        <tbody>
          {containers.slice(0, 6).map((c) => (
            <tr key={c.id} onClick={() => openSubject({ kind: "container", id: c.id })} title={`Open ${c.name}`} style={{ cursor: "pointer" }}>
              <td>
                <span className={`status-badge ${c.state === "running" ? "running" : "stopped"}`}>
                  <span className="dot" />{c.state}
                </span>
              </td>
              <td><OriginBadge c={c} /></td>
              <td style={{ fontWeight: 600 }} title={c.name}>{c.name}</td>
              <td title={c.image}>{c.image}</td>
              <td style={{ color: "var(--muted)" }} title={c.status}>{c.status}</td>
            </tr>
          ))}
          {containers.length === 0 && <tr><td colSpan={5} className="empty">No containers</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
