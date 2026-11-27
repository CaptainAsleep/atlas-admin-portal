import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./lib/firebase";

// #photo-reports (2026-11-26): photos players reported (profile photos, card
// photos, public child photos). A photo is hidden automatically after reports
// from 3 different players and waits here for Restore or Remove. Data:
// photoReportCases (admin-read rule); the photo itself is in private storage
// and comes through the admin-only getReportedPhoto callable. Scope: project
// doc claude/atlas-card-photo-change-scope.md.
const TABS = [
  { id: "hidden", label: "Hidden", match: (s) => s === "hidden" || s === "hiding" },
  { id: "open", label: "Reported", match: (s) => s === "open" },
  { id: "done", label: "Resolved", match: (s) => s === "cleared" || s === "removed" },
];
const fmt = (ts) => (ts?.toDate ? ts.toDate().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const KIND = { adult: "Player", child: "Public child" };
const TARGET = { profile: "Profile photo", card: "Card photo" };

function CasePhoto({ c }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const load = () => {
    setLoading(true);
    setErr("");
    httpsCallable(functions, "getReportedPhoto")({ caseId: c.id })
      .then((r) => setSrc(r.data.dataUrl || r.data.url || null))
      .catch((e) => { console.error("getReportedPhoto failed:", e); setErr("Couldn't load the photo."); })
      .finally(() => setLoading(false));
  };
  if (src) return <img src={src} alt="Reported" className="w-40 h-40 object-cover rounded-lg border border-cream-line" />;
  return (
    <div className="w-40 h-40 rounded-lg border border-cream-line flex flex-col items-center justify-center gap-1 text-sm text-ink-soft">
      <button onClick={load} className="underline" disabled={loading}>{loading ? "Loading…" : "View photo"}</button>
      {err && <span className="text-negative text-xs">{err}</span>}
    </div>
  );
}

export default function PhotoReportsPage({ onBack }) {
  const [cases, setCases] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("hidden");
  const [busy, setBusy] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    getDocs(query(collection(db, "photoReportCases"), orderBy("lastReportAt", "desc"), limit(200)))
      .then((s) => setCases(s.docs.map((d) => ({ id: d.id, ...d.data() }))))
      .catch((e) => { console.error("photoReportCases load failed:", e); setError("Couldn't load reports."); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const act = async (c, action) => {
    const what = {
      remove: "Remove this photo for good? The player can add a new one.",
      restore: "Restore this photo? It goes back on their profile or card, and the same reporters can't hide it again.",
      hide: "Hide this photo now? It comes off their profile or card until you restore or remove it.",
      dismiss: "Dismiss these reports? The photo stays up, and the same players can't report it again.",
    }[action];
    if (!window.confirm(what)) return;
    setBusy(c.id);
    try {
      await httpsCallable(functions, "resolvePhotoReport")({ caseId: c.id, action });
      load();
    } catch (e) {
      console.error("resolvePhotoReport failed:", e);
      window.alert(e?.message || "That didn't work.");
    } finally {
      setBusy(null);
    }
  };

  const current = TABS.find((t) => t.id === tab);
  const shown = (cases || []).filter((c) => current.match(c.status));

  return (
    <div className="min-h-screen bg-cream font-body">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm">
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="font-display font-bold text-lg">Photo reports</h1>
          <button onClick={load} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-ink mb-6 max-w-3xl">
          Players can report profile photos, card photos and public child photos. After reports from 3 different players a photo is hidden
          (moved to private storage) until you restore or remove it here. Under 3 reports you can dismiss the reports, hide the photo now, or remove it. Card photos aren't reviewed before they go live.
          If a reported photo could show a child being sexually exploited, don&apos;t restore it, and report it to NCMEC (CyberTipline) before removing it.
        </p>

        <div className="flex gap-2 mb-5">
          {TABS.map((t) => {
            const n = (cases || []).filter((c) => t.match(c.status)).length;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-full text-sm ${tab === t.id ? "bg-navy text-white" : "bg-white text-ink border border-cream-line"}`}>
                {t.label}{cases ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>

        {error && <p className="text-negative text-sm mb-4">{error}</p>}
        {!cases ? (
          <p className="text-sm text-ink-soft">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing here.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((c) => (
              <section key={c.id} className="bg-white rounded-2xl shadow-md p-5 flex gap-5 items-start">
                {tab === "done" ? null : <CasePhoto c={c} />}
                <div className="flex-1 min-w-0 text-sm">
                  <div className="font-display font-bold text-base text-navy">{c.callsign || "(no callsign)"}</div>
                  <div className="text-ink">{KIND[c.ownerKind] || c.ownerKind} · {TARGET[c.target] || c.target}</div>
                  <div className="text-ink-soft mt-1">
                    {c.reportCount || (c.reporters || []).length} report{(c.reportCount || (c.reporters || []).length) === 1 ? "" : "s"} · last {fmt(c.lastReportAt)}
                    {c.hiddenAt ? ` · hidden ${fmt(c.hiddenAt)}` : ""}
                    {c.resolvedAt ? ` · ${c.status === "removed" ? "removed" : c.dismissed ? "dismissed" : "restored"} ${fmt(c.resolvedAt)}` : ""}
                  </div>
                  {c.status === "hiding" && <div className="text-negative mt-1">Hiding didn&apos;t finish. Refresh in a minute; if it stays, check the function logs.</div>}
                  {c.note && <div className="text-ink-soft mt-1">{c.note}</div>}
                  <div className="text-ink-soft text-xs mt-1 font-mono break-all">{c.ownerId}</div>
                  {c.status === "open" && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button disabled={busy === c.id} onClick={() => act(c, "dismiss")} className="px-3 py-1.5 rounded-full border border-cream-line text-ink hover:bg-cream">Dismiss</button>
                      <button disabled={busy === c.id} onClick={() => act(c, "hide")} className="px-3 py-1.5 rounded-full border border-negative text-negative hover:bg-cream">Hide now</button>
                      <button disabled={busy === c.id} onClick={() => act(c, "remove")} className="px-3 py-1.5 rounded-full bg-negative text-white">Remove photo</button>
                    </div>
                  )}
                  {c.status === "hidden" && (
                    <div className="flex gap-2 mt-3">
                      <button disabled={busy === c.id} onClick={() => act(c, "restore")} className="px-3 py-1.5 rounded-full border border-cream-line text-ink hover:bg-cream">Restore</button>
                      <button disabled={busy === c.id} onClick={() => act(c, "remove")} className="px-3 py-1.5 rounded-full bg-negative text-white">Remove photo</button>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
