import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { getAdminFeedback } from "./hooks/useAdminData";

// #feedback (2026-10-21): every post-event feedback response, with
// callsigns -- admin-only, unlike the owner app's Settings > Feedback,
// which shows owners their field ratings without names. Data comes from
// the getAdminFeedback callable (functions/feedback.js).
const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "—");
const fmtDate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function Stars({ n }) {
  if (!n) return <span className="text-ink-soft">—</span>;
  return (
    <span className={n <= 2 ? "text-negative" : "text-accent"} title={`${n} of 5`}>
      {"★".repeat(n)}<span className="text-cream-line">{"★".repeat(5 - n)}</span>
    </span>
  );
}

export default function FeedbackPage({ onBack }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fieldFilter, setFieldFilter] = useState("all");

  const load = () => {
    setLoading(true);
    setError("");
    getAdminFeedback()
      .then((r) => setEvents(r.events || []))
      .catch((err) => { console.error("getAdminFeedback failed:", err); setError("Couldn't load feedback."); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const fields = events ? [...new Set(events.map((e) => e.fieldName).filter(Boolean))].sort() : [];
  const shown = (events || []).filter((e) => fieldFilter === "all" || e.fieldName === fieldFilter);

  return (
    <div className="min-h-screen bg-cream font-body">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm">
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="font-display font-bold text-lg">Event feedback</h1>
          <button onClick={load} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-ink mb-6 max-w-3xl">
          Requests go out automatically at 6pm Detroit time the day after an event ends, to every checked-in booking plus the host owner.
          Any 1–2 star answer also emails you right away. Owners see their field ratings and field comments in the owner app (Settings → Feedback), without names.
        </p>

        {fields.length > 1 && (
          <div className="mb-6">
            <select value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} className="bg-white rounded-lg shadow-sm px-3 py-2 text-sm text-navy">
              <option value="all">All fields</option>
              {fields.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}

        {error && <p className="text-negative text-sm mb-4">{error}</p>}
        {!error && events === null && <p className="text-ink-soft text-sm">Loading…</p>}
        {events && shown.length === 0 && (
          <div className="bg-white rounded-2xl shadow-md p-6 text-ink">No feedback requests have gone out yet.</div>
        )}

        <div className="flex flex-col gap-6">
          {shown.map((e) => {
            const players = e.responses.filter((r) => r.role === "player");
            const owner = e.responses.find((r) => r.role === "owner");
            return (
              <section key={e.eventId} className="bg-white rounded-2xl shadow-md p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
                  <div>
                    <h2 className="font-display font-bold text-navy">{e.fieldName} — {e.eventTitle}</h2>
                    <p className="text-sm text-ink-soft">{fmtDate(e.eventDate)}</p>
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div><div className="text-ink-soft">Responses</div><div className="font-display font-bold text-navy text-lg">{players.length} / {e.sent}</div></div>
                    <div><div className="text-ink-soft">Field avg</div><div className="font-display font-bold text-navy text-lg">{avg(players.map((r) => r.fieldRating).filter(Boolean))}</div></div>
                    <div><div className="text-ink-soft">Atlas avg</div><div className="font-display font-bold text-navy text-lg">{avg(players.map((r) => r.atlasRating).filter(Boolean))}</div></div>
                    <div><div className="text-ink-soft">Owner on Atlas</div><div className="font-display font-bold text-navy text-lg">{owner ? `${owner.atlasRating}/5` : "—"}</div></div>
                  </div>
                </div>
                {e.responses.length === 0 ? (
                  <p className="text-sm text-ink-soft">No responses yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead>
                        <tr className="text-left text-ink-soft">
                          <th className="py-2 pr-3 font-medium">Who</th>
                          <th className="py-2 pr-3 font-medium">Field</th>
                          <th className="py-2 pr-3 font-medium">Field comment</th>
                          <th className="py-2 pr-3 font-medium">Atlas</th>
                          <th className="py-2 pr-3 font-medium">Atlas comment</th>
                          <th className="py-2 font-medium">Flags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.responses.map((r, i) => (
                          <tr key={i} className="border-t border-cream-dim align-top">
                            <td className="py-2 pr-3 text-navy font-medium whitespace-nowrap">{r.role === "owner" ? "Owner" : r.callsign || "Player"}</td>
                            <td className="py-2 pr-3 whitespace-nowrap">{r.role === "owner" ? <span className="text-ink-soft">n/a</span> : <Stars n={r.fieldRating} />}</td>
                            <td className="py-2 pr-3 text-ink whitespace-pre-wrap">{r.fieldComment}</td>
                            <td className="py-2 pr-3 whitespace-nowrap"><Stars n={r.atlasRating} /></td>
                            <td className="py-2 pr-3 text-ink whitespace-pre-wrap">{r.atlasComment}</td>
                            <td className="py-2 text-ink-soft whitespace-nowrap">
                              {[r.quoteConsent && "OK to quote", r.callOptIn && "Open to a call"].filter(Boolean).join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
