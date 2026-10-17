import { useEffect, useRef, useState } from "react";
import { getEmailInsights } from "./hooks/useAdminData";
import { mountInsights } from "./insightsCharts";

// Always dark, independent of the rest of this (light-cream) admin
// portal and of the viewer's system color-scheme preference -- Michael
// asked to keep the dark look from the one-off dashboard this replaces
// (docs/Atlas_Signup_Email_Insights.html in the Atlas repo root) as this
// page's own visual identity, not a theme toggle.
const DARK_VARS = {
  "--ei-page": "#0d0d0d",
  "--ei-surface": "#1a1a19",
  "--ei-ink": "#f0efec",
  "--ei-ink2": "#c3c2b7",
  "--ei-muted": "#898781",
  "--ei-grid": "#2c2c2a",
  "--ei-axis": "#383835",
  "--ei-border": "rgba(255,255,255,.10)",
  "--s1": "#3987e5",
  "--s2": "#d95926",
  "--s3": "#199e70",
  "--s4": "#c98500",
  "--gray": "#6b6a64",
  "--good": "#0ca30c",
  "--warn": "#fab219",
  "--bad": "#ec835a",
  // insightsCharts.js reads var(--page)/var(--surface)/etc (unprefixed,
  // matching the original HTML's own variable names) -- aliased here
  // rather than renaming them throughout that ported file.
  "--page": "#0d0d0d",
  "--surface": "#1a1a19",
  "--ink": "#f0efec",
  "--ink2": "#c3c2b7",
  "--muted": "#898781",
  "--grid": "#2c2c2a",
  "--axis": "#383835",
  "--border": "rgba(255,255,255,.10)",
};

const EMPTY_RESEND = { emailTotal: 0, emailByType: {}, emailStatus: {}, emailDaily: [], emailSeries: [] };

// Firestore Timestamp objects (and the occasional plain ISO string, from
// an older doc shape) both need to become something `new Date(...)` can
// parse -- insightsCharts.js's formatting helpers were ported from a
// static page that only ever saw plain ISO strings, so this normalizes
// both inputs into that same shape at the boundary rather than teaching
// every formatter in that file about Firestore Timestamps.
function toIso(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export default function EmailInsightsPage({ data, s, onBack }) {
  const [resend, setResend] = useState(null);
  const [resendError, setResendError] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getEmailInsights()
      .then((r) => {
        if (!cancelled) setResend(r);
      })
      .catch((err) => {
        console.error("getEmailInsights failed:", err);
        if (!cancelled) setResendError("Couldn't load Resend email stats — try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const insights = s?.insights || null;
  const resendData = resend || EMPTY_RESEND;

  useEffect(() => {
    if (!insights || !containerRef.current) return;
    const D = {
      stats: {
        realAccounts: insights.realAccounts,
        onboarded: insights.onboarded,
        bookers: insights.bookers,
        medianLag: insights.medianLag,
        within10: insights.within10,
        within60: insights.within60,
        within24h: insights.within24h,
        over7d: insights.over7d,
        onboardedNotBooked: insights.onboardedNotBooked,
        emailTotal: resendData.emailTotal,
        emailByType: resendData.emailByType,
        emailStatus: resendData.emailStatus,
      },
      buckets: insights.buckets,
      bookers: insights.bookerList.map((b) => ({
        ...b,
        createdAt: toIso(b.createdAt),
        booked: toIso(b.booked),
      })),
      daily: insights.daily,
      emailDaily: resendData.emailDaily,
    };
    const cleanup = mountInsights(containerRef.current, D);
    return cleanup;
    // Re-run whenever either data source changes. resendData/insights are
    // freshly-built objects each render, so this effectively re-renders on
    // every render of this component -- fine here: mountInsights fully
    // replaces each card's content rather than patching it, and nothing
    // above causes a tight render loop (data/resend only change on real
    // fetch results).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insights, resendData]);

  return (
    <div style={{ ...DARK_VARS, background: "var(--ei-page)", minHeight: "100vh" }}>
      <div className="ei-wrap" ref={containerRef}>
        <style>{EI_CSS}</style>
        <div className="ei-topbar">
          <button type="button" className="ei-back" onClick={onBack}>
            ← Back to dashboard
          </button>
        </div>
        <header>
          <h1>Email &amp; signup insights</h1>
          <p>
            Live from Resend and Atlas's own Firestore data — recomputed every time this page loads, not a saved
            snapshot.
          </p>
        </header>

        {!insights ? (
          <p className="ei-cap" style={{ marginTop: 24 }}>
            Loading dashboard data…
          </p>
        ) : (
          <>
            <section className="ei-hero" id="ei-hero" aria-live="polite" />
            <div className="ei-tiles" id="ei-tiles" />

            <section className="ei-card" id="ei-c-buckets">
              <div className="ei-card-top">
                <div>
                  <h2>How long after creating an account did players book?</h2>
                  <div className="ei-sub">First event booked, counted from the moment the account was created.</div>
                </div>
                <button className="ei-tv" data-card="buckets" aria-pressed="false">
                  View as table
                </button>
              </div>
              <div className="ei-legend" id="ei-lg-buckets" />
              <div className="ei-chart" id="ei-ch-buckets" />
              <div className="ei-cap" id="ei-cap-buckets" />
            </section>

            <section className="ei-card" id="ei-c-dots">
              <div className="ei-card-top">
                <div>
                  <h2>Every player who booked, one dot each</h2>
                  <div className="ei-sub">
                    Time from account creation to first booking, on a log scale (each gridline is roughly 10×
                    longer). Rows are sorted fastest to slowest and labeled with the day the account was created.
                  </div>
                </div>
                <button className="ei-tv" data-card="dots" aria-pressed="false">
                  View as table
                </button>
              </div>
              <div className="ei-legend" id="ei-lg-dots" />
              <div className="ei-chart" id="ei-ch-dots" />
            </section>

            <section className="ei-card" id="ei-c-funnel">
              <div className="ei-card-top">
                <div>
                  <h2>From account to booking</h2>
                  <div className="ei-sub">Every real account, no exclusions.</div>
                </div>
                <button className="ei-tv" data-card="funnel" aria-pressed="false">
                  View as table
                </button>
              </div>
              <div className="ei-legend" id="ei-lg-funnel" />
              <div className="ei-chart" id="ei-ch-funnel" />
              <div className="ei-cap" id="ei-cap-funnel" />
            </section>

            <section className="ei-card" id="ei-c-daily">
              <div className="ei-card-top">
                <div>
                  <h2>Sign-ups and bookings by day</h2>
                  <div className="ei-sub">Accounts created and first bookings, Detroit time.</div>
                </div>
                <button className="ei-tv" data-card="daily" aria-pressed="false">
                  View as table
                </button>
              </div>
              <div className="ei-legend" id="ei-lg-daily" />
              <div className="ei-chart" id="ei-ch-daily" />
              <div className="ei-cap" id="ei-cap-daily" />
            </section>

            <section className="ei-card" id="ei-c-email">
              <div className="ei-card-top">
                <div>
                  <h2>Emails sent by day</h2>
                  <div className="ei-sub">Every transactional email in Resend, grouped by type. Detroit time.</div>
                </div>
                <button className="ei-tv" data-card="email" aria-pressed="false">
                  View as table
                </button>
              </div>
              {resendError && <p className="ei-cap" style={{ color: "var(--bad)" }}>{resendError}</p>}
              <div className="ei-legend" id="ei-lg-email" />
              <div className="ei-chart" id="ei-ch-email" />
              <div className="ei-cap" id="ei-cap-email" />
            </section>

            <section className="ei-card" id="ei-c-delivery">
              <div className="ei-card-top">
                <div>
                  <h2>Delivery</h2>
                  <div className="ei-sub">Outcome of every email Resend has on file.</div>
                </div>
              </div>
              <div className="ei-status" id="ei-status" />
              <div className="ei-cap" id="ei-cap-delivery" />
            </section>

            <section className="ei-card" id="ei-c-notes">
              <h2>What this does and doesn't tell you</h2>
              <ul className="ei-notes" id="ei-notes" />
            </section>

            <div className="ei-foot">
              Sources: Atlas Firestore (account and booking timestamps) and the live Resend email log. Recomputed on
              every page load.
            </div>
          </>
        )}
        <div id="ei-tip" hidden role="status" />
      </div>
    </div>
  );
}

const EI_CSS = `
.ei-wrap { max-width: 980px; margin: 0 auto; padding: 0 16px 64px; color: var(--ei-ink); font: 15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
.ei-topbar { padding: 16px 0 0; }
.ei-back { font: inherit; font-size: 13.5px; color: var(--ei-ink2); background: transparent; border: none; cursor: pointer; padding: 0; }
.ei-back:hover { color: var(--ei-ink); text-decoration: underline; }
.ei-wrap header h1 { font-size: 24px; margin: 18px 0 4px; font-weight: 650; letter-spacing: -.01em; color: var(--ei-ink); }
.ei-wrap header p { margin: 0; color: var(--ei-ink2); }
.ei-hero { margin: 22px 0 12px; background: var(--ei-surface); border: 1px solid var(--ei-border); border-radius: 14px; padding: 22px 24px; }
.ei-hero .ei-big { font-size: 56px; line-height: 1.05; font-weight: 700; letter-spacing: -.02em; }
.ei-hero .ei-big small { display: block; margin: 6px 0 0; font-size: 20px; font-weight: 500; color: var(--ei-ink2); letter-spacing: 0; }
.ei-hero p { margin: 8px 0 0; font-size: 17px; max-width: 62ch; }
.ei-hero p.ei-sub { color: var(--ei-ink2); font-size: 15px; }
.ei-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap: 12px; margin: 12px 0 22px; }
.ei-tile { background: var(--ei-surface); border: 1px solid var(--ei-border); border-radius: 12px; padding: 14px 16px; }
.ei-tile .ei-l { color: var(--ei-ink2); font-size: 13px; }
.ei-tile .ei-v { font-size: 28px; font-weight: 650; letter-spacing: -.01em; }
.ei-tile .ei-d { color: var(--ei-muted); font-size: 12.5px; }
.ei-card { background: var(--ei-surface); border: 1px solid var(--ei-border); border-radius: 14px; padding: 18px 20px 14px; margin: 0 0 16px; }
.ei-card h2 { font-size: 17px; margin: 0; font-weight: 650; color: var(--ei-ink); }
.ei-card .ei-sub { color: var(--ei-ink2); font-size: 13.5px; margin: 2px 0 10px; max-width: 70ch; }
.ei-card-top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.ei-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--ei-ink2); margin: 0 0 6px; }
.ei-legend span { display: inline-flex; gap: 6px; align-items: center; }
.ei-sw { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
button.ei-tv { font: inherit; font-size: 12.5px; color: var(--ei-ink2); background: transparent; border: 1px solid var(--ei-border); border-radius: 8px; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
button.ei-tv:hover { background: var(--ei-grid); }
.ei-chart { width: 100%; }
.ei-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
.ei-cap { color: var(--ei-ink2); font-size: 13.5px; margin: 8px 0 2px; max-width: 74ch; }
.ei-mk { transition: opacity .12s; }
.ei-band { opacity: 0; fill: var(--ei-ink); fill-opacity: .06; }
.ei-row:hover .ei-band, .ei-row:focus .ei-band, .ei-slot:hover .ei-band, .ei-slot:focus .ei-band { opacity: 1; }
.ei-row, .ei-slot { outline: none; cursor: default; }
.ei-wrap text { font-family: inherit; }
.ei-tick { fill: var(--ei-muted); font-size: 12px; }
.ei-lab { fill: var(--ei-ink2); font-size: 12.5px; }
.ei-val { fill: var(--ei-ink); font-size: 12.5px; font-weight: 600; }
.ei-halo { paint-order: stroke; stroke: var(--ei-surface); stroke-width: 4px; stroke-linejoin: round; }
#ei-tip { position: fixed; z-index: 10; pointer-events: none; background: var(--ei-surface); color: var(--ei-ink); border: 1px solid var(--ei-border); box-shadow: 0 6px 24px rgba(0,0,0,.4); border-radius: 10px; padding: 8px 10px; font-size: 13px; max-width: 260px; }
.ei-tip-h { color: var(--ei-ink2); font-size: 12px; margin-bottom: 3px; }
.ei-tip-r { display: flex; gap: 6px; align-items: center; white-space: nowrap; }
.ei-tip-r span:last-child { color: var(--ei-ink2); }
.ei-tip-k { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
table.ei-dt { width: 100%; border-collapse: collapse; font-size: 13px; }
table.ei-dt th, table.ei-dt td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--ei-grid); color: var(--ei-ink); }
table.ei-dt th { color: var(--ei-ink2); font-weight: 600; position: sticky; top: 0; background: var(--ei-surface); }
table.ei-dt td.n, table.ei-dt th.n { text-align: right; font-variant-numeric: tabular-nums; }
.ei-tbl-scroll { max-height: 360px; overflow: auto; }
.ei-status { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px,1fr)); gap: 10px; margin-top: 4px; }
.ei-status div { border: 1px solid var(--ei-border); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; }
.ei-status b { display: block; font-size: 22px; font-weight: 650; }
.ei-ic { font-weight: 700; margin-right: 4px; }
ul.ei-notes { margin: 6px 0 0; padding-left: 18px; color: var(--ei-ink2); font-size: 14px; }
ul.ei-notes li { margin: 5px 0; }
.ei-foot { color: var(--ei-muted); font-size: 12.5px; margin-top: 18px; }
@media (max-width: 560px) { .ei-hero .ei-big { font-size: 46px; } .ei-hero { padding: 18px; } .ei-card { padding: 14px 12px 10px; } }
`;
