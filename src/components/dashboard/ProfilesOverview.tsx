import type { DashboardContext } from "./context";

export function ProfilesOverview({ profiles, selected, chooseProfile }: DashboardContext) {
  return (
    <div className="card">
      <div className="card-label">Profiles overview</div>
      <table className="table" style={{ marginTop: 6 }}>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.name} onClick={() => chooseProfile(p.name)} style={{ cursor: "pointer", background: selected === p.name ? "rgba(34,197,94,0.07)" : undefined }}>
              <td style={{ padding: "6px 0" }}>{p.name}</td>
              <td style={{ padding: "6px 0", textAlign: "right" }}>
                <span className={`status-badge ${p.status.toLowerCase() === "running" ? "running" : "stopped"}`}>
                  <span className="dot" />{p.status}
                </span>
              </td>
            </tr>
          ))}
          {profiles.length === 0 && <tr><td className="muted">No profiles</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
