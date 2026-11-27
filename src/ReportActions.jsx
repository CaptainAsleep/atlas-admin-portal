import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./lib/firebase";

// Shared photo-report controls (2026-11-26), used on #photo-reports and in the
// #cards detail panel. Every action goes through the admin-only
// resolvePhotoReport callable, which re-checks the report's status itself.
const CONFIRM = {
  remove: "Remove this photo for good? The player can add a new one.",
  restore: "Restore this photo? It goes back on their profile or card, and the same reporters can't hide it again.",
  hide: "Hide this photo now? It comes off their profile or card until you restore or remove it.",
  dismiss: "Dismiss these reports? The photo stays up, and the same players can't report it again.",
};
const BTN = {
  quiet: "px-3 py-1.5 rounded-full border border-cream-line text-ink hover:bg-cream text-sm",
  warn: "px-3 py-1.5 rounded-full border border-negative text-negative hover:bg-cream text-sm",
  danger: "px-3 py-1.5 rounded-full bg-negative text-white text-sm",
};

export function ReportActions({ caseId, status, onDone }) {
  const [busy, setBusy] = useState(false);
  const act = async (action) => {
    if (!window.confirm(CONFIRM[action])) return;
    setBusy(true);
    try {
      await httpsCallable(functions, "resolvePhotoReport")({ caseId, action });
      onDone?.();
    } catch (e) {
      console.error("resolvePhotoReport failed:", e);
      window.alert(e?.message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  if (status === "open") {
    return (
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => act("dismiss")} className={BTN.quiet}>Dismiss</button>
        <button disabled={busy} onClick={() => act("hide")} className={BTN.warn}>Hide now</button>
        <button disabled={busy} onClick={() => act("remove")} className={BTN.danger}>Remove photo</button>
      </div>
    );
  }
  if (status === "hidden") {
    return (
      <div className="flex flex-wrap gap-2">
        <button disabled={busy} onClick={() => act("restore")} className={BTN.quiet}>Restore</button>
        <button disabled={busy} onClick={() => act("remove")} className={BTN.danger}>Remove photo</button>
      </div>
    );
  }
  return null;
}

// A reported photo: the live one, or the hidden copy from private storage.
export function ReportedPhoto({ caseId, className = "w-40 h-40" }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const load = () => {
    setLoading(true);
    setErr("");
    httpsCallable(functions, "getReportedPhoto")({ caseId })
      .then((r) => setSrc(r.data.dataUrl || r.data.url || null))
      .catch((e) => { console.error("getReportedPhoto failed:", e); setErr("Couldn't load the photo."); })
      .finally(() => setLoading(false));
  };
  if (src) return <img src={src} alt="Reported" className={`${className} object-cover rounded-lg border border-cream-line`} />;
  return (
    <div className={`${className} rounded-lg border border-cream-line flex flex-col items-center justify-center gap-1 text-sm text-ink-soft`}>
      <button onClick={load} className="underline" disabled={loading}>{loading ? "Loading…" : "View photo"}</button>
      {err && <span className="text-negative text-xs">{err}</span>}
    </div>
  );
}
