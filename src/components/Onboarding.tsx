import { Fragment, useState } from "react";
import type { SystemStatus } from "../types";
import { TOOLS, type ToolKey } from "../dependencies";
import { RefreshIcon } from "./RefreshIcon";

const STEPS = ["Welcome", "Tools"];
const REQUIRED: ToolKey[] = ["colima", "docker"];

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const SURFACES = [
  {
    title: "Dashboard",
    text: "VM counts, Docker totals and per-container CPU. Updates arrive from Docker's event stream, so the numbers move when something changes.",
    icon: <svg {...ICON}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>,
  },
  {
    title: "Docker",
    text: "Containers, images, volumes and networks — with used-by links, a topology map, logs and live stats.",
    icon: <svg {...ICON}><path d="M21 8l-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>,
  },
  {
    title: "Machine",
    text: "The Linux VM itself: runtime, sockets, kernel and load, guest memory, disk and OOM kills, plus other Lima VMs.",
    icon: <svg {...ICON}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></svg>,
  },
];

export function Onboarding({ tools, onRecheck, onFinish, onSkip }: {
  tools: SystemStatus | null;
  onRecheck: () => void;
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const keys = Object.keys(TOOLS) as ToolKey[];
  const installed = tools ? keys.filter((k) => tools[k]) : [];
  const coreReady = !!tools?.colima && !!tools?.docker;

  return (
    <div className="onboarding-backdrop">
      <div className="onboarding" role="dialog" aria-modal="true" aria-label="First-time setup">
        <div className="onboarding-top">
          <div className="onboarding-brand">
            <img src="/logo.png" alt="" width={22} height={22} />
            Colima Desk
          </div>
          <div className="onboarding-step">Step {step + 1} of {STEPS.length} · {STEPS[step]}</div>
        </div>
        <div className="onboarding-progress"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>

        <div className="onboarding-body">
          {step === 0 && (
            <div className="onboarding-welcome">
              <h2>Everything Colima runs, in one window.</h2>
              <p className="onboarding-lead">
                Your containers run in a Linux VM. Colima Desk only reads the Colima and Docker
                command-line tools already on this machine — nothing is installed or changed.
              </p>
              <ul className="onboarding-surfaces">
                {SURFACES.map((s) => (
                  <li key={s.title}>
                    <span className="onboarding-surface-icon">{s.icon}</span>
                    <span>
                      <strong>{s.title}</strong>
                      <span className="onboarding-surface-text">{s.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="onboarding-note">Next: what is installed, and what each tool adds.</p>
            </div>
          )}

          {step === 1 && (
            <>
              <div className="onboarding-head">
                <div>
                  <h2>{tools ? `${installed.length} of ${keys.length} tools detected` : "Checking your machine…"}</h2>
                  <p className="onboarding-lead">Required tools unlock whole sections; optional ones add detail.</p>
                </div>
                <button className="icon-plain" onClick={onRecheck} disabled={!tools} aria-label="Recheck installed tools" title="Recheck installed tools">
                  <RefreshIcon />
                </button>
              </div>
              <ul className="onboarding-tools">
                {[
                  { title: "Required for most views", keys: REQUIRED },
                  ...(["Kubernetes", "Runtimes", "AI", "VMs"] as const).map((title) => ({
                    title,
                    keys: keys.filter((k) => !REQUIRED.includes(k) && TOOLS[k].group === title),
                  })),
                ]
                  .filter((group) => group.keys.length > 0)
                  .map((group) => (
                    <Fragment key={group.title}>
                      <li className="onboarding-group">{group.title === "Required for most views" ? "Required" : `${group.title} · optional`}</li>
                      {group.keys.map((key) => {
                        const ok = tools?.[key] ?? false;
                        const info = TOOLS[key];
                        return (
                          <li key={key} className={ok ? "ok" : "missing"}>
                            <span className={`tool-pill ${ok ? "on" : "off"}`}><span className="tool-dot" />{ok ? "ready" : "missing"}</span>
                            <div className="onboarding-tool-text">
                              <div className="onboarding-tool-name">{info.label}</div>
                              <div className="onboarding-tool-why">{info.why}</div>
                              <div className="onboarding-tool-unlocks"><span className="onboarding-unlock-k">In app</span> {info.unlocks}</div>
                              {!ok && (
                                <div className="onboarding-install">
                                  <code title={info.install}>{info.install}</code>
                                  <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(info.install)}>Copy</button>
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </Fragment>
                  ))}
              </ul>
              {tools && !coreReady && (
                <p className="onboarding-warn">
                  Colima or Docker is missing. Most views stay empty until it is installed.
                </p>
              )}
              <p className="onboarding-note">Reopen this any time from Settings → General → Run setup again.</p>
            </>
          )}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={onSkip}>Skip setup</button>
          <div className="onboarding-actions-right">
            {step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
            {step === 0
              ? <button className="btn primary" onClick={() => setStep(1)} disabled={!tools}>Continue</button>
              : <button className="btn primary" onClick={onFinish} title={coreReady ? undefined : "Colima or Docker is missing"}>Open Dashboard</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
