import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./lib/firebase";

// #skins (2026-11-09): paid-skin sales. Reads skinPurchases (one record per
// paid Stripe session that granted skins — written only by the webhook,
// readable only by the admin) and counts players with "Notify me" on.
// Scope: project doc claude/atlas-skins-scope.md.
//
// Revenue here is GROSS. Stripe fees are ESTIMATED with the standard
// formula — real fees live in Stripe, not Firestore:
//   single / bundle (its own payment): 2.9% + 30c
//   add-on (rides on a booking whose 30c is already paid): 2.9%

// Display names; keep in sync with functions/skins.js in atlas-players-app.
const SKIN_NAMES = {
  ridgeline: "Ridgeline",
  "ridgeline-black": "Ridgeline Black",
  m81: "M81 Woodland",
  gunmetal: "Gun Metal",
  neon: "Neon",
};
const VIA = ["single", "bundle", "addon"];
const VIA_LABEL = { single: "Single", bundle: "Bundle", addon: "Booking add-on" };

export const estFeeCents = (p) => Math.round((p.amountCents || 0) * 0.029) + (p.via === "addon" ? 0 : 30);
const money = (c) => `$${(c / 100).toFixed(2)}`;
const toDate = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);
const monthKey = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` : "unknown");
const monthLabel = (k) => (k === "unknown" ? "Unknown" : new Date(`${k}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" }));

export function summarizeSkinPurchases(purchases) {
  const totals = { gross: 0, fees: 0, count: purchases.length, byVia: { single: 0, bundle: 0, addon: 0 } };
  const months = {};
  const owners = {};
  for (const p of purchases) {
    const via = VIA.includes(p.via) ? p.via : "single";
    const amt = p.amountCents || 0;
    const fee = estFeeCents({ ...p, via });
    totals.gross += amt;
    totals.fees += fee;
    totals.byVia[via] += amt;
    const k = monthKey(toDate(p.createdAt));
    months[k] = months[k] || { single: 0, bundle: 0, addon: 0, gross: 0, fees: 0, count: 0 };
    months[k][via] += amt;
    months[k].gross += amt;
    months[k].fees += fee;
    months[k].count += 1;
    for (const id of p.granted || []) owners[id] = (owners[id] || 0) + 1;
  }
  return { totals, months: Object.entries(months).sort((a, b) => (a[0] < b[0] ? 1 : -1)), owners };
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow-md p-5">
      <div className="text-sm text-ink-soft">{label}</div>
      <div className="font-display font-bold text-navy text-2xl">{value}</div>
      {sub && <div className="text-xs text-ink-soft mt-1">{sub}</div>}
    </div>
  );
}

export default function SkinsPage({ onBack }) {
  const [purchases, setPurchases] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    Promise.all([
      getDocs(collection(db, "skinPurchases")),
      getDocs(query(collection(db, "users"), where("skinDropAlerts", "==", true))),
    ])
      .then(([p, a]) => { setPurchases(p.docs.map((d) => ({ id: d.id, ...d.data() }))); setAlerts(a.size); })
      .catch((err) => { console.error("SkinsPage load failed:", err); setError("Couldn't load skin data."); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const sum = purchases ? summarizeSkinPurchases(purchases) : null;

  return (
    <div className="min-h-screen bg-cream font-body">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm">
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="font-display font-bold text-lg">Skins</h1>
          <button onClick={load} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-ink mb-6 max-w-3xl">
          Gross skin revenue from Atlas's own records. Stripe fees are estimates (2.9% + 30¢ for an Appearance-screen purchase,
          2.9% for a booking add-on, whose 30¢ the booking already paid) — exact fees are in Stripe.
        </p>
        {error && <p className="text-negative text-sm mb-4">{error}</p>}
        {!error && !sum && <p className="text-ink-soft text-sm">Loading…</p>}
        {sum && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Stat label="Gross revenue" value={money(sum.totals.gross)} sub={`${sum.totals.count} purchase${sum.totals.count === 1 ? "" : "s"}`} />
              <Stat label="Est. Stripe fees" value={money(sum.totals.fees)} sub="estimate" />
              <Stat label="Est. net" value={money(sum.totals.gross - sum.totals.fees)} />
              <Stat label={'"Notify me" on'} value={alerts ?? "—"} sub="players waiting on the next drop" />
            </section>

            <section className="bg-white rounded-2xl shadow-md p-5 mb-6">
              <h2 className="font-display font-bold text-navy mb-3">By channel</h2>
              <div className="flex gap-8 text-sm flex-wrap">
                {VIA.map((v) => (
                  <div key={v}><div className="text-ink-soft">{VIA_LABEL[v]}</div><div className="font-display font-bold text-navy text-lg">{money(sum.totals.byVia[v])}</div></div>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-2xl shadow-md p-5 mb-6 overflow-x-auto">
              <h2 className="font-display font-bold text-navy mb-3">By month</h2>
              {sum.months.length === 0 ? (
                <p className="text-sm text-ink-soft">No skin sales yet.</p>
              ) : (
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-ink-soft">
                      <th className="py-2 pr-3 font-medium">Month</th>
                      {VIA.map((v) => <th key={v} className="py-2 pr-3 font-medium text-right">{VIA_LABEL[v]}</th>)}
                      <th className="py-2 pr-3 font-medium text-right">Gross</th>
                      <th className="py-2 pr-3 font-medium text-right">Est. fees</th>
                      <th className="py-2 font-medium text-right">Est. net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.months.map(([k, m]) => (
                      <tr key={k} className="border-t border-cream-dim">
                        <td className="py-2 pr-3 text-navy font-medium">{monthLabel(k)}</td>
                        {VIA.map((v) => <td key={v} className="py-2 pr-3 text-right">{money(m[v])}</td>)}
                        <td className="py-2 pr-3 text-right font-medium text-navy">{money(m.gross)}</td>
                        <td className="py-2 pr-3 text-right text-ink-soft">{money(m.fees)}</td>
                        <td className="py-2 text-right">{money(m.gross - m.fees)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="bg-white rounded-2xl shadow-md p-5">
              <h2 className="font-display font-bold text-navy mb-3">Owners per skin</h2>
              <table className="w-full text-sm max-w-md">
                <tbody>
                  {[...new Set([...Object.keys(SKIN_NAMES), ...Object.keys(sum.owners)])].map((id) => (
                    <tr key={id} className="border-t border-cream-dim first:border-t-0">
                      <td className="py-2 pr-3 text-navy">{SKIN_NAMES[id] || id}</td>
                      <td className="py-2 text-right font-medium">{sum.owners[id] || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
