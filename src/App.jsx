import { useState } from "react";
import {
  LayoutDashboard, LogOut, RefreshCw, ShieldAlert, MapPin, Users,
  CalendarDays, Ticket, DollarSign, AlertCircle, ExternalLink, Package, Search, Wallet, Check,
  UserCircle2, Shield, Award, Bookmark,
} from "lucide-react";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { useAdminData, summarize, FEE_MODEL_LABELS, setWelcomePackageSent } from "./hooks/useAdminData";

function money(cents) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Display text for a field's status (see INACTIVE_FIELD_STATUSES in
// useAdminData.js) — hover the badge in the Fields table for Michael's
// own notes on why a given field landed in one of these.
const FIELD_STATUS_LABELS = { closed: "closed", "no-airsoft": "no airsoft", relocated: "relocated" };

function LoginScreen({ onSignIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onSignIn(email, password);
    } catch (err) {
      setError(err.message || "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm bg-cream rounded-xl p-8 shadow-xl">
        <h1 className="font-display text-2xl font-bold text-navy mb-1">Atlas Admin</h1>
        <p className="text-sm text-ink-soft mb-6">Sign in with your Atlas owner account.</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-cream-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-cream-line bg-white px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {error && <p className="text-sm text-negative">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-navy text-white font-medium py-2.5 text-sm shadow-lg shadow-navy/25 disabled:opacity-60 disabled:shadow-none"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function NotAuthorized({ email, onSignOut }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm bg-cream rounded-xl p-8 shadow-xl text-center">
        <ShieldAlert className="mx-auto mb-3 text-negative" size={32} />
        <h1 className="font-display text-lg font-bold text-navy mb-1">Not authorized</h1>
        <p className="text-sm text-ink-soft mb-6">
          {email} isn't the admin account for this portal.
        </p>
        <button onClick={onSignOut} className="text-sm text-accent underline">
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, tone = "navy", className = "" }) {
  const toneClasses = { navy: "text-navy", positive: "text-positive", accent: "text-accent" };
  const badgeClasses = { navy: "bg-cream text-navy", positive: "bg-positive/10 text-positive", accent: "bg-accent/10 text-accent" };
  return (
    <div className={`bg-white rounded-2xl shadow-md p-4 ${className}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center mb-2.5 ${badgeClasses[tone]}`}>
        <Icon size={14} />
      </div>
      <div className="text-ink-soft text-[10px] font-semibold uppercase tracking-wide mb-0.5">{label}</div>
      <div className={`font-display text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-ink-soft mt-1">{sub}</div>}
    </div>
  );
}

function Dashboard({ email, onSignOut }) {
  const { data, loading, error, reload } = useAdminData();
  const s = summarize(data);
  // Both lists are capped-height + searchable rather than growing the page
  // forever — Fields especially: fine today at one field, unusable as a
  // full-page scroll once Atlas is national. The sticky jump nav below
  // covers the "get me to Addresses without scrolling past all of Fields"
  // case regardless of how long either list gets.
  const [fieldSearch, setFieldSearch] = useState("");
  const [addressSearch, setAddressSearch] = useState("");
  const fieldRows = (s?.fieldRows || []).filter((f) =>
    `${f.name} ${f.ownerName} ${f.status}`.toLowerCase().includes(fieldSearch.toLowerCase())
  );
  const addressRows = (s?.fieldRows || [])
    .filter((f) => f.claimed)
    .filter((f) => `${f.name} ${f.ownerName}`.toLowerCase().includes(addressSearch.toLowerCase()));

  // Marking a welcome package "Sent" is the admin portal's one write path
  // (everything else here is read-only by design). No optimistic local
  // state — it writes, then reloads from Firestore, same as the header's
  // own Refresh button, so this stays the single source of truth rather
  // than risking the UI and the database disagreeing after a failed write.
  const [sendingIds, setSendingIds] = useState(new Set());
  const [sendError, setSendError] = useState("");
  async function handleToggleSent(fieldId, sent) {
    setSendError("");
    setSendingIds((prev) => new Set(prev).add(fieldId));
    try {
      await setWelcomePackageSent(fieldId, sent);
      await reload();
    } catch (err) {
      console.error("Couldn't update welcome package status:", err);
      setSendError("Couldn't save — try again.");
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.delete(fieldId);
        return next;
      });
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <header className="bg-navy text-white px-6 py-4 flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={20} />
            <span className="font-display font-bold">Atlas Admin</span>
          </div>
          {/* Jump to the other two apps — opens in a new tab rather than
              navigating this dashboard's own tab away, same convention as
              every external redirect elsewhere in Atlas (see atlas-stack.md). */}
          <nav className="flex items-center gap-3 text-sm opacity-90">
            <a
              href="https://playerapp.airsoftatlas.app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:opacity-100 hover:underline"
            >
              Player App <ExternalLink size={12} />
            </a>
            <a
              href="https://ownerapp.airsoftatlas.app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:opacity-100 hover:underline"
            >
              Owner App <ExternalLink size={12} />
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <button onClick={reload} className="flex items-center gap-1 opacity-90 hover:opacity-100" title="Refresh">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <span className="opacity-70">{email}</span>
          <button onClick={onSignOut} className="flex items-center gap-1 opacity-90 hover:opacity-100">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>

      {/* Sticky so you can jump straight to a section from anywhere on the
          page — the real fix for "scroll forever to reach Addresses" as
          Fields grows, independent of section order or either list's
          length. */}
      <nav className="sticky top-0 z-20 bg-cream/95 backdrop-blur shadow-sm px-6 py-2 flex items-center gap-4 text-sm">
        <a href="#fields" className="text-ink hover:text-accent">Fields</a>
        <a href="#addresses" className="text-ink hover:text-accent">Welcome package addresses</a>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-6 flex items-center gap-2 bg-negative/10 text-negative border border-negative/30 rounded-lg px-4 py-3 text-sm">
            <AlertCircle size={16} /> Couldn't load data: {error.message}
          </div>
        )}

        {loading && !data && <p className="text-ink-soft text-sm">Loading Atlas's current state…</p>}

        {s && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {/* Row 1: the two headline revenue numbers, each spanning
                  half the grid so they read as a pair above the detail
                  cards rather than competing with them for attention. */}
              <StatCard
                icon={DollarSign}
                label="Total Atlas Revenue"
                value={money(s.totalAtlasRevenueCents)}
                sub="all-time platform fees"
                tone="positive"
                className="col-span-2"
              />
              <StatCard
                icon={Wallet}
                label="Total Payout Revenue"
                value={money(s.payoutRevenueCents)}
                sub={`sent to field owners — ${s.estimatedFeeCount ? `${s.estimatedFeeCount} bookings estimated (pre-tracking)` : "all-time, exact"}`}
                tone="accent"
                className="col-span-2"
              />
              <StatCard
                icon={MapPin}
                label="Fields claimed"
                value={`${s.fieldsClaimed} / ${s.fieldsTotal}`}
                sub={[
                  s.fieldsPending ? `${s.fieldsPending} pending claim` : "no pending claims",
                  s.fieldsInactive ? `${s.fieldsInactive} closed/no-airsoft excluded` : null,
                ].filter(Boolean).join(" · ")}
              />
              <StatCard
                icon={Ticket}
                label="Paid bookings (all-time)"
                value={s.paidBookingsTotal}
                sub={`${s.paidBookingsThisMonth} this month`}
              />
              <StatCard
                icon={Users}
                label="Field owners"
                value={s.ownersTotal}
                sub={`${s.payoutsEnabledCount} ready for payouts`}
              />
              <StatCard
                icon={CalendarDays}
                label="Events"
                value={s.eventsTotal}
                sub={`${s.upcomingEventsCount} upcoming`}
              />
              <StatCard
                icon={UserCircle2}
                label="Players"
                value={s.playersTotal ?? "—"}
                sub={s.playersTotal == null ? "couldn't load — check permissions" : "with a public profile"}
              />
              <StatCard
                icon={Shield}
                label="Teams"
                value={s.teamsTotal ?? "—"}
                sub={s.teamsTotal == null ? "couldn't load — check permissions" : undefined}
              />
              <StatCard
                icon={Award}
                label="Patches received"
                value={s.patchesTotal ?? "—"}
                sub={s.patchesTotal == null ? "couldn't load — check permissions" : "across all players"}
              />
              <StatCard
                icon={Bookmark}
                label="Saved events"
                value={s.savedEventsTotal}
                sub="currently favorited, not cumulative"
              />
            </section>

            <section className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-2xl shadow-md p-5">
                <h2 className="font-display font-bold text-navy mb-3">Owners by fee model</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(FEE_MODEL_LABELS).map(([key, label]) => (
                      <tr key={key} className="border-t border-cream-dim">
                        <td className="py-2 text-ink">{label}</td>
                        <td className="py-2 text-right font-medium text-navy">{s.ownersByFeeModel[key] || 0}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-cream-dim">
                      <td className="py-2 text-ink">Not chosen yet</td>
                      <td className="py-2 text-right font-medium text-navy">{s.ownersByFeeModel.unset || 0}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section id="fields" className="bg-white rounded-2xl shadow-md p-5 scroll-mt-16">
              <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
                <h2 className="font-display font-bold text-navy">Fields ({fieldRows.length}{fieldSearch ? ` of ${s.fieldRows.length}` : ""})</h2>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" />
                  <input
                    type="text"
                    value={fieldSearch}
                    onChange={(e) => setFieldSearch(e.target.value)}
                    placeholder="Search field or owner…"
                    className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-cream-line bg-cream/50 outline-none focus:border-accent w-56"
                  />
                </div>
              </div>
              {/* Capped height + its own scroll, not the page's — this is
                  the part that actually keeps the table usable once it's
                  hundreds of rows long, not just findable via the search
                  box above. */}
              <div className="overflow-auto max-h-[28rem] border border-cream-dim rounded-lg">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="sticky top-0 bg-white shadow-sm">
                    <tr className="text-left text-ink-soft text-xs uppercase tracking-wide">
                      <th className="pb-2 pt-2 pl-2 font-medium">Field</th>
                      <th className="pb-2 pt-2 font-medium">Owner</th>
                      <th className="pb-2 pt-2 font-medium">Field status</th>
                      <th className="pb-2 pt-2 font-medium">Claim</th>
                      <th className="pb-2 pt-2 font-medium text-right">Events</th>
                      <th className="pb-2 pt-2 font-medium text-right">Paid bookings</th>
                      <th className="pb-2 pt-2 pr-2 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldRows.map((f) => (
                      <tr key={f.id} className="border-t border-cream-dim">
                        <td className="py-2 pl-2 text-navy font-medium">{f.name}</td>
                        <td className="py-2 text-ink">{f.ownerName}</td>
                        <td className="py-2 text-ink" title={f.statusNotes || undefined}>
                          {f.status === "active" ? (
                            <span className="text-positive">active</span>
                          ) : (
                            <span className="text-ink-soft underline decoration-dotted">
                              {FIELD_STATUS_LABELS[f.status] || f.status}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-ink">
                          {f.claimPending ? (
                            <span className="text-accent">pending claim</span>
                          ) : f.claimed ? (
                            <span className="text-positive">claimed</span>
                          ) : (
                            <span className="text-ink-soft">unclaimed</span>
                          )}
                        </td>
                        <td className="py-2 text-right">{f.eventsCount}</td>
                        <td className="py-2 text-right">{f.paidBookingsCount}</td>
                        <td className="py-2 pr-2 text-right font-medium">{money(f.revenueCents)}</td>
                      </tr>
                    ))}
                    {fieldRows.length === 0 && (
                      <tr><td colSpan={7} className="py-4 text-center text-ink-soft">No fields match "{fieldSearch}".</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="addresses" className="bg-white rounded-2xl shadow-md p-5 mt-8 scroll-mt-16">
              <div className="flex items-center justify-between mb-1 gap-4 flex-wrap">
                <h2 className="font-display font-bold text-navy flex items-center gap-2">
                  <Package size={16} /> Welcome package addresses ({addressRows.length}{addressSearch ? ` of ${s.fieldRows.filter((f) => f.claimed).length}` : ""})
                </h2>
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft" />
                  <input
                    type="text"
                    value={addressSearch}
                    onChange={(e) => setAddressSearch(e.target.value)}
                    placeholder="Search field or owner…"
                    className="pl-8 pr-3 py-1.5 text-sm rounded-lg border border-cream-line bg-cream/50 outline-none focus:border-accent w-56"
                  />
                </div>
              </div>
              <p className="text-xs text-ink-soft mb-3">
                Where to actually ship stickers, a tablet stand, etc. Private, owner-provided — separate from a
                field's public listing address, since some fields have no one on-site to receive mail. Claimed
                fields only; a blank row just means that owner hasn't filled theirs in yet.
              </p>
              {sendError && (
                <div className="mb-3 flex items-center gap-2 bg-negative/10 text-negative border border-negative/30 rounded-lg px-3 py-2 text-xs">
                  <AlertCircle size={14} /> {sendError}
                </div>
              )}
              <div className="overflow-auto max-h-[28rem] border border-cream-dim rounded-lg">
                <table className="w-full text-sm min-w-[640px]">
                  <thead className="sticky top-0 bg-white shadow-sm">
                    <tr className="text-left text-ink-soft text-xs uppercase tracking-wide">
                      <th className="pb-2 pt-2 pl-2 font-medium">Field</th>
                      <th className="pb-2 pt-2 font-medium">Owner</th>
                      <th className="pb-2 pt-2 font-medium">Recipient</th>
                      <th className="pb-2 pt-2 font-medium">Address</th>
                      <th className="pb-2 pt-2 font-medium">Notes</th>
                      <th className="pb-2 pt-2 pr-2 font-medium text-right">Sent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addressRows.map((f) => {
                      const a = f.shippingAddress;
                      const hasAddress = a && (a.line1 || a.city);
                      return (
                        <tr key={f.id} className="border-t border-cream-dim align-top">
                          <td className="py-2 pl-2 text-navy font-medium">{f.name}</td>
                          <td className="py-2 text-ink">{f.ownerName}</td>
                          <td className="py-2 text-ink">{a?.recipientName || (hasAddress ? "—" : "")}</td>
                          <td className="py-2 text-ink">
                            {hasAddress ? (
                              <>
                                {a.line1}
                                {a.line2 ? `, ${a.line2}` : ""}
                                <br />
                                {[a.city, a.state, a.zip].filter(Boolean).join(", ")}
                              </>
                            ) : (
                              <span className="text-ink-soft italic">not provided yet</span>
                            )}
                          </td>
                          <td className="py-2 text-ink-soft">{a?.notes || ""}</td>
                          <td className="py-2 pr-2 text-right">
                            <button
                              onClick={() => handleToggleSent(f.id, !a?.sent)}
                              disabled={sendingIds.has(f.id)}
                              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors disabled:opacity-50 ${
                                a?.sent
                                  ? "bg-positive/10 text-positive border-positive/30 hover:bg-positive/20"
                                  : "bg-cream text-ink-soft border-cream-line hover:border-accent hover:text-accent"
                              }`}
                              title={a?.sent ? "Click to unmark" : "Mark this field's welcome package as sent"}
                            >
                              {a?.sent ? (
                                <>
                                  <Check size={12} /> Sent
                                </>
                              ) : (
                                "Mark sent"
                              )}
                            </button>
                            {a?.sent && a?.sentAt?.toDate && (
                              <div className="text-[10px] text-ink-soft mt-1">
                                {a.sentAt.toDate().toLocaleDateString()}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {addressRows.length === 0 && (
                      <tr><td colSpan={6} className="py-4 text-center text-ink-soft">No matches.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="text-xs text-ink-soft mt-6">
              Last loaded {data.fetchedAt.toLocaleTimeString()}. "Total Atlas Revenue" is Atlas's own cut
              (Atlas Standard's platform fee — 3.5% + $1.30, capped at $5.00), not the full amount players
              paid — most of that goes straight to field owners as "Total Payout Revenue." Figures reflect
              Firestore, not Stripe directly, so refunds aren't backed out yet.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const { user, authLoading, isAdmin, signIn, signOut } = useAdminAuth();

  if (authLoading) {
    return <div className="min-h-screen bg-navy" />;
  }
  if (!user) {
    return <LoginScreen onSignIn={signIn} />;
  }
  if (!isAdmin) {
    return <NotAuthorized email={user.email} onSignOut={signOut} />;
  }
  return <Dashboard email={user.email} onSignOut={signOut} />;
}
