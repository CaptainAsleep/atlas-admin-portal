import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { collectionGroup, deleteDoc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./lib/firebase";

// #patches (2026-10-27): every patch made outside the admin catalog — field
// owners' unlockable patches (fields/{id}/fieldPatches) and team officers'
// library uploads (teams/{id}/teamPatches) — so Michael can take one down.
// Field patches are retired (active: false: stops unlocking, holders keep
// it); team uploads are removed from the library (holders keep it too).
// Needs the {path=**}/fieldPatches and {path=**}/teamPatches read rules.
export default function CustomPatchesPage({ onBack }) {
  const [fieldPatches, setFieldPatches] = useState(null);
  const [teamPatches, setTeamPatches] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([getDocs(collectionGroup(db, "fieldPatches")), getDocs(collectionGroup(db, "teamPatches"))])
      .then(([fp, tp]) => {
        const ms = (t) => t?.toMillis?.() || 0;
        setFieldPatches(fp.docs.map((d) => ({ ref: d.ref, id: d.id, fieldId: d.ref.parent.parent.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)));
        setTeamPatches(tp.docs.map((d) => ({ ref: d.ref, id: d.id, teamId: d.ref.parent.parent.id, ...d.data() })).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)));
      })
      .catch((err) => { console.error("custom patches load failed:", err); setError("Couldn't load patches."); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const act = async (key, fn) => {
    setBusyKey(key);
    try { await fn(); load(); } catch (err) { console.error(err); setError("That change failed."); } finally { setBusyKey(null); }
  };

  const fmt = (t) => (t?.toDate ? t.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
  const ruleText = (rules) => (!rules || rules.length === 0 ? "Manual only" : rules.map((r) => `${r.type} ×${r.count}${r.eventType ? ` (${r.eventType})` : ""}${r.keywords ? ` [${r.keywords.join(", ")}]` : ""}${r.start ? ` ${r.start}→${r.end}` : ""}`).join("  OR  "));

  return (
    <div className="min-h-screen bg-cream font-body">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm">
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="font-display font-bold text-lg">Owner &amp; team patches</h1>
          <button onClick={load} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-8">
        {error && <p className="text-negative text-sm">{error}</p>}

        <section className="bg-white rounded-2xl shadow-md p-5">
          <h2 className="font-display font-bold text-navy mb-1">Field patches</h2>
          <p className="text-sm text-ink-soft mb-4">Built by field owners. Retiring stops new unlocks; players who have it keep it.</p>
          {fieldPatches === null ? <p className="text-sm text-ink-soft">Loading…</p> : fieldPatches.length === 0 ? <p className="text-sm text-ink">None yet.</p> : (
            <div className="flex flex-col divide-y divide-cream-line">
              {fieldPatches.map((p) => (
                <div key={p.ref.path} className="py-3 flex items-center gap-4">
                  <img src={p.imageUrl} alt="" className="w-12 h-12 object-contain flex-shrink-0" style={{ opacity: p.active === false ? 0.4 : 1 }} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-navy">{p.name} <span className="text-ink-soft font-normal text-sm">· {p.fieldId}</span></div>
                    {p.details && <div className="text-sm text-ink">{p.details}</div>}
                    <div className="text-xs text-ink-soft">{ruleText(p.rules)} · created {fmt(p.createdAt)}{p.migratedFromCatalogId ? ` · migrated from catalog "${p.migratedFromCatalogId}"` : ""}</div>
                  </div>
                  <button
                    disabled={busyKey === p.ref.path}
                    onClick={() => act(p.ref.path, () => updateDoc(p.ref, { active: p.active === false, updatedAt: serverTimestamp() }))}
                    className={`text-sm font-semibold px-3 py-1.5 rounded-lg border ${p.active === false ? "text-navy border-cream-line" : "text-negative border-negative"}`}
                  >
                    {p.active === false ? "Reactivate" : "Retire"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow-md p-5">
          <h2 className="font-display font-bold text-navy mb-1">Team patch libraries</h2>
          <p className="text-sm text-ink-soft mb-4">What team officers can give out. Removing an entry stops new grants; members who have it keep it.</p>
          {teamPatches === null ? <p className="text-sm text-ink-soft">Loading…</p> : teamPatches.length === 0 ? <p className="text-sm text-ink">None yet.</p> : (
            <div className="flex flex-col divide-y divide-cream-line">
              {teamPatches.map((p) => (
                <div key={p.ref.path} className="py-3 flex items-center gap-4">
                  <img src={p.imageUrl} alt="" className="w-12 h-12 object-contain flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-navy">{p.name} <span className="text-ink-soft font-normal text-sm">· team {p.teamId}</span></div>
                    {p.details && <div className="text-sm text-ink">{p.details}</div>}
                    <div className="text-xs text-ink-soft">{p.catalogId ? `Atlas catalog patch "${p.catalogId}"` : "Officer upload"} · added {fmt(p.createdAt)}</div>
                  </div>
                  {!p.catalogId && (
                    <button
                      disabled={busyKey === p.ref.path}
                      onClick={() => { if (window.confirm(`Remove ${p.name} from this team's library?`)) act(p.ref.path, () => deleteDoc(p.ref)); }}
                      className="text-sm font-semibold px-3 py-1.5 rounded-lg border text-negative border-negative"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
