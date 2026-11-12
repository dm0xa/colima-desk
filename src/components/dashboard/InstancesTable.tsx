import { fmtBytes } from "../../lib/format";
import type { DashboardContext } from "./context";

export function InstancesTable({ profiles, selected, chooseProfile }: DashboardContext) {
  return (
    <div className="card instances-card">
      <div className="instances-head">
        <div className="strip-title">Instances</div>
        <span className="instances-hint">select a profile to scope the other views</span>
      </div>
      <div className="instances-table-wrap">
        <table className="table table-instances">
          <thead><tr><th>Profile</th><th>Status</th><th>Runtime</th><th>Arch</th><th>Resources</th></tr></thead>
          <tbody>
            {profiles.length === 0 && <tr><td colSpan={5} className="empty">No instances</td></tr>}
            {profiles.map((p) => {
              const running = p.status.toLowerCase() === "running";
              return (
                <tr key={p.name} onClick={() => chooseProfile(p.name)} style={{ cursor: "pointer", background: selected === p.name ? "rgba(34,197,94,0.07)" : undefined }}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td><span className={`status-badge ${running ? "running" : "stopped"}`}><span className="dot" />{p.status}</span></td>
                  <td>{p.runtime ?? "—"}</td>
                  <td>{p.arch ?? "—"}</td>
                  <td className="instances-resources">
                    {p.cpus ?? "—"} CPU · {fmtBytes(p.memory)} · {fmtBytes(p.disk)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
