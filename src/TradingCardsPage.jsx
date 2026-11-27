import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, RefreshCw, X } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./lib/firebase";
import { ReportActions, ReportedPhoto } from "./ReportActions.jsx";

// #cards (2026-11-26): every trading card (players + public kids) with its
// photo, real pixel size, sharp/low-res, free/paid changes, consent, rank,
// deck and reports. Data comes from the admin-only getAdminCardOverview
// callable (atlas-players-app/functions/index.js). Pixel size is measured in
// this browser when the photo loads; "Marked" is what the server recorded.
const SHARP_PX = 1000; // long side at or above = sharp (new uploads are 1,200px)
const OK_PX = 600;
const TIER_LABEL = { unranked: "Unranked", common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary", onyx: "Onyx", diamond: "Diamond", founder: "Founder" };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const money = (c) => `$${((c || 0) / 100).toFixed(2)}`;

function quality(px) {
  if (!px) return null;
  const long = Math.max(px.w, px.h);
  return long >= SHARP_PX ? "sharp" : long >= OK_PX ? "ok" : "low";
}
const Q_STYLE = { sharp: "bg-green-100 text-green-800", ok: "bg-amber-100 text-amber-800", low: "bg-red-100 text-negative" };
const Q_LABEL = { sharp: "Sharp", ok: "Medium", low: "Low-res" };

function Badge({ className = "", children }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${className}`}>{children}</span>;
}

function consentText(c) {
  if (!c) return "Not asked yet";
  if (c.choice === "out") return "Opted out";
  return c.current ? "Opted in" : "Opted in (old terms)";
}

const REPORT_STATUS = { open: "Reported", hiding: "Hiding…", hidden: "Hidden", cleared: "Resolved", removed: "Removed" };

function Detail({ row, px, onClose, onChanged }) {
  const q = quality(px);
  const Line = ({ k, v }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-cream-line text-sm">
      <span className="text-ink-soft">{k}</span><span className="text-ink text-right">{v}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog">
      <button className="absolute inset-0 bg-black/40" onClick={onClose} aria-label="Close" />
      <aside className="relative w-full max-w-md h-full overflow-y-auto bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-xl text-navy">{row.callsign || "(no callsign)"}</h2>
          <button onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="flex gap-4 mb-5">
          <div className="flex-1">
            <div className="text-xs text-ink-soft mb-1">Card photo</div>
            {row.cardPhotoUrl
              ? <a href={row.cardPhotoUrl} target="_blank" rel="noopener noreferrer"><img src={row.cardPhotoUrl} alt="Card" className="w-full rounded-lg border border-cream-line object-contain bg-cream" style={{ maxHeight: 320 }} /></a>
              : <div className="w-full h-40 rounded-lg border border-dashed border-cream-line flex items-center justify-center text-sm text-ink-soft">No card photo</div>}
          </div>
          <div className="w-24">
            <div className="text-xs text-ink-soft mb-1">Profile photo</div>
            {row.avatarUrl
              ? <a href={row.avatarUrl} target="_blank" rel="noopener noreferrer"><img src={row.avatarUrl} alt="Profile" className="w-24 h-24 rounded-full object-cover border border-cream-line" /></a>
              : <div className="w-24 h-24 rounded-full bg-cream flex items-center justify-center text-ink-soft text-xs">None</div>}
          </div>
        </div>
        <Line k="Type" v={row.kind === "child" ? `Public child (parent: ${row.guardianCallsign || "?"})` : "Player"} />
        <Line k="Serial" v={row.serial ? `#${row.serial}` : "—"} />
        <Line k="Photo size" v={px ? `${px.w} × ${px.h}px` : row.cardPhotoUrl ? "Loading…" : "—"} />
        <Line k="Quality (measured)" v={q ? Q_LABEL[q] : "—"} />
        <Line k="Marked by server" v={row.cardPhotoHiRes == null ? "—" : row.cardPhotoHiRes ? "Sharp" : "Low-res (from old profile photo)"} />
        <Line k="Card photo changes" v={`${row.cardPhotoChanges} (${row.cardPhotoChanges === 0 ? "free photo unused" : "free photo used"})`} />
        <Line k="Migrated to new storage" v={row.migrated ? "Yes" : "No — run migrate-card-photos.mjs"} />
        {row.credits && <Line k="Paid changes" v={`${row.credits.paid} bought (${money(row.credits.cents)}), ${row.credits.unused} unused`} />}
        <Line k="Rank" v={`${TIER_LABEL[row.tier] || row.tier}${row.rankOverride ? ` (hand-set: ${row.rankOverride})` : ""}${row.rankFloor ? ` · floor ${row.rankFloor}` : ""}`} />
        {row.creator && <Line k="Creator tag" v={row.creator} />}
        <Line k="In circulation" v={`${row.circulation} deck${row.circulation === 1 ? "" : "s"}`} />
        {row.deck != null && <Line k="Their deck" v={`${row.deck} card${row.deck === 1 ? "" : "s"}`} />}
        <Line k="Events / fields / patches" v={row.stats ? `${row.stats.ops ?? 0} / ${row.stats.fields ?? 0} / ${row.stats.patches ?? 0}` : "—"} />
        {row.kind === "adult" && <Line k="Likeness consent" v={`${consentText(row.consent)}${row.consent?.at ? ` · ${fmtDate(row.consent.at)}` : ""}`} />}
        {row.kind === "adult" && row.packConsent && <Line k="Trading & packs" v={consentText(row.packConsent)} />}
        <Line k="Card hidden (opt-out)" v={row.optOut ? "Yes" : "No"} />
        <div className="mt-4 mb-2">
          <div className="text-sm font-semibold text-navy mb-2">Reports</div>
          {row.reports.length === 0 ? (
            <div className="text-sm text-ink-soft">None</div>
          ) : row.reports.map((r) => (
            <div key={r.caseId} className="border border-cream-line rounded-xl p-3 mb-2">
              <div className="flex items-center justify-between gap-2 text-sm mb-2">
                <span className="text-ink">{r.target === "card" ? "Card photo" : "Profile photo"}</span>
                <span className="text-ink-soft">{REPORT_STATUS[r.status] || r.status} · {r.count} report{r.count === 1 ? "" : "s"}</span>
              </div>
              {r.status === "hidden" && <div className="mb-2"><ReportedPhoto caseId={r.caseId} className="w-28 h-28" /></div>}
              <ReportActions caseId={r.caseId} status={r.status} onDone={onChanged} />
            </div>
          ))}
        </div>
        <Line k="Joined" v={fmtDate(row.createdAt)} />
        <div className="text-xs text-ink-soft font-mono break-all mt-3">{row.id}</div>
      </aside>
    </div>
  );
}

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "none", label: "No card photo", test: (r) => !r.cardPhotoUrl },
  { id: "low", label: "Low-res", test: (r, q) => r.cardPhotoUrl && (q === "low" || q === "ok" || (!q && r.cardPhotoHiRes === false)) },
  { id: "sharp", label: "Sharp", test: (r, q) => q === "sharp" },
  { id: "paid", label: "Paid changes", test: (r) => (r.credits?.paid || 0) > 0 },
  { id: "notin", label: "Not opted in", test: (r) => r.kind === "adult" && !(r.consent?.choice === "in" && r.consent?.current) },
  { id: "reported", label: "Reported", test: (r) => r.reports.length > 0 },
  { id: "kids", label: "Kids", test: (r) => r.kind === "child" },
  { id: "unmigrated", label: "Not migrated", test: (r) => !r.migrated },
];

export default function TradingCardsPage({ onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [px, setPx] = useState({}); // id -> { w, h }
  const [openKey, setOpenKey] = useState(null);

  const load = () => {
    setLoading(true);
    setError("");
    httpsCallable(functions, "getAdminCardOverview")()
      .then((r) => setData(r.data))
      .catch((e) => { console.error("getAdminCardOverview failed:", e); setError("Couldn't load cards."); })
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const rows = useMemo(() => {
    const all = (data?.rows || []).slice().sort((a, b) => (a.serial ?? 1e9) - (b.serial ?? 1e9));
    const f = FILTERS.find((x) => x.id === filter);
    const s = search.trim().toLowerCase();
    return all.filter((r) => f.test(r, quality(px[r.id])) && (!s || (r.callsign || "").toLowerCase().includes(s) || (r.guardianCallsign || "").toLowerCase().includes(s)));
  }, [data, filter, search, px]);

  const all = data?.rows || [];
  // Looked up from the latest data, so the panel updates after an action reloads it.
  const openRow = openKey ? all.find((r) => `${r.kind}_${r.id}` === openKey) : null;
  const tiles = data ? [
    ["Cards", all.length],
    ["With card photo", all.filter((r) => r.cardPhotoUrl).length],
    ["No card photo", all.filter((r) => !r.cardPhotoUrl).length],
    ["Marked low-res", all.filter((r) => r.cardPhotoHiRes === false).length],
    ["Free photo used", all.filter((r) => r.cardPhotoChanges > 0).length],
    ["Paid changes", `${data.totals.creditsSold} · ${money(data.totals.creditCents)}`],
    ["Opted in", all.filter((r) => r.consent?.choice === "in" && r.consent?.current).length],
    ["Not migrated", all.filter((r) => !r.migrated).length],
  ] : [];

  const measure = (id) => (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setPx((m) => (m[id] ? m : { ...m, [id]: { w, h } }));
  };

  return (
    <div className="min-h-screen bg-cream font-body">
      <header className="bg-navy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <button onClick={onBack} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm"><ChevronLeft size={16} /> Dashboard</button>
          <h1 className="font-display font-bold text-lg">Trading cards</h1>
          <button onClick={load} className="flex items-center gap-1 opacity-90 hover:opacity-100 text-sm" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <p className="text-sm text-ink mb-5 max-w-3xl">
          Every player and public child card. Photo size is measured from the actual image: Sharp is {SHARP_PX}px or more on the long side, Medium is {OK_PX}–{SHARP_PX - 1}px, and Low-res is under {OK_PX}px.
          Click a row for everything about that card.
        </p>
        {error && <p className="text-negative text-sm mb-4">{error}</p>}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {tiles.map(([k, v]) => (
              <div key={k} className="bg-white rounded-2xl shadow-md p-4">
                <div className="text-xs text-ink-soft">{k}</div>
                <div className="font-display font-bold text-2xl text-navy">{v}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-sm ${filter === f.id ? "bg-navy text-white" : "bg-white text-ink border border-cream-line"}`}>{f.label}</button>
          ))}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search callsign…"
            className="ml-auto px-3 py-1.5 rounded-full border border-cream-line text-sm bg-white" />
        </div>

        {!data ? (
          <p className="text-sm text-ink-soft">{loading ? "Loading…" : ""}</p>
        ) : (
          <div className="bg-white rounded-2xl shadow-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-ink-soft border-b border-cream-line">
                <tr>
                  <th className="p-3">Photo</th><th className="p-3">#</th><th className="p-3">Callsign</th><th className="p-3">Quality</th>
                  <th className="p-3">Changes</th><th className="p-3">Rank</th><th className="p-3">Decks</th><th className="p-3">Consent</th><th className="p-3">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const q = quality(px[r.id]);
                  return (
                    <tr key={`${r.kind}_${r.id}`} onClick={() => setOpenKey(`${r.kind}_${r.id}`)} className="border-b border-cream-line hover:bg-cream cursor-pointer">
                      <td className="p-2">
                        {r.cardPhotoUrl
                          ? <img src={r.cardPhotoUrl} alt="" loading="lazy" onLoad={measure(r.id)} className="w-10 h-14 object-cover rounded border border-cream-line" />
                          : <div className="w-10 h-14 rounded border border-dashed border-cream-line" />}
                      </td>
                      <td className="p-3 text-ink-soft">{r.serial ?? "—"}</td>
                      <td className="p-3">
                        <div className="font-semibold text-navy">{r.callsign || "(none)"}</div>
                        {r.kind === "child" && <div className="text-xs text-ink-soft">Kid · parent {r.guardianCallsign || "?"}</div>}
                      </td>
                      <td className="p-3">
                        {!r.cardPhotoUrl ? <span className="text-ink-soft">No photo</span>
                          : q ? <Badge className={Q_STYLE[q]}>{Q_LABEL[q]} · {Math.max(px[r.id].w, px[r.id].h)}px</Badge>
                          : <span className="text-ink-soft">…</span>}
                      </td>
                      <td className="p-3">{r.cardPhotoChanges}{r.credits?.paid ? <span className="text-ink-soft"> · {r.credits.paid} paid</span> : ""}</td>
                      <td className="p-3">{TIER_LABEL[r.tier] || r.tier}</td>
                      <td className="p-3">{r.circulation}</td>
                      <td className="p-3">{r.kind === "child" ? <span className="text-ink-soft">Parent</span> : consentText(r.consent)}</td>
                      <td className="p-3 space-x-1">
                        {r.optOut && <Badge className="bg-cream text-ink">Opted out</Badge>}
                        {!r.migrated && <Badge className="bg-amber-100 text-amber-800">Not migrated</Badge>}
                        {r.reports.some((x) => x.status === "hidden") && <Badge className="bg-red-100 text-negative">Hidden</Badge>}
                        {r.reports.some((x) => x.status === "open") && <Badge className="bg-amber-100 text-amber-800">Reported</Badge>}
                        {r.credits?.unused ? <Badge className="bg-green-100 text-green-800">Unused credit</Badge> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="p-4 text-sm text-ink-soft">Nothing matches.</p>}
          </div>
        )}
      </main>
      {openRow && <Detail row={openRow} px={px[openRow.id]} onClose={() => setOpenKey(null)} onChanged={load} />}
    </div>
  );
}
