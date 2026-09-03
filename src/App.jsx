import { useState } from "react";
import {
  LayoutDashboard, LogOut, RefreshCw, ShieldAlert, MapPin, Users,
  CalendarDays, Ticket, DollarSign, Clock3, TrendingUp, AlertCircle, ExternalLink, Package,
} from "lucide-react";
import { useAdminAuth } from "./hooks/useAdminAuth";
import { useAdminData, summarize } from "./hooks/useAdminData";

function money(cents) {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

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
            className="w-full rounded-lg bg-navy text-white font-medium py-2 text-sm disabled:opacity-60"
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

function StatCard({ icon: Icon, label, value, sub, tone = "navy" }) {
  const toneClasses = { navy: "text-navy", positive: "text-positive", accent: "text-accent" };
  return (
    <div className="bg-white rounded-xl border border-cream-line p-4">
      <div className="flex items-center gap-2 text-ink-soft text-xs font-medium uppercase tracking-wide mb-2">
        <Icon size={14} /> {label}
      </div>
      <div className={`font-display text-2xl font-bold ${toneClasses[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-ink-soft mt-1">{sub}</div>}
    </div>
  );
}

function Dashboard({ email, onSignOut }) {
  const { data, loading, error, reload } = useAdminData();
  const s = summarize(data);

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
              <StatCard
                icon={MapPin}
                label="Fields claimed"
                value={`${s.fieldsClaimed} / ${s.fieldsTotal}`}
                sub={s.fieldsPending ? `${s.fieldsPending} pending claim` : "no pending claims"}
              />
              <StatCard
                icon={Ticket}
                label="Paid bookings (all-time)"
                value={s.paidBookingsTotal}
                sub={`${s.paidBookingsThisMonth} this month`}
              />
              <StatCard
                icon={DollarSign}
                label="Booking fee revenue"
                value={money(s.bookingFeeRevenueCents)}
                sub={s.estimatedFeeCount ? `${s.estimatedFeeCount} estimated (pre-tracking)` : "all-time, exact"}
                tone="positive"
              />
              <StatCard
                icon={TrendingUp}
                label="Active MRR"
                value={money(s.activeMRR * 100)}
                sub={s.trialingCount ? `+${money(s.trialingPotentialMRR * 100)} if ${s.trialingCount} trial(s) convert` : "no active trials"}
                tone="accent"
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
                icon={Clock3}
                label="Trialing owners"
                value={s.trialingCount}
                sub="30-day free trial in progress"
              />
              <StatCard
                icon={ShieldAlert}
                label="Past due / canceled"
                value={(s.ownersByStatus.past_due || 0) + (s.ownersByStatus.canceled || 0) + (s.ownersByStatus.unpaid || 0)}
                sub="needs a look"
              />
            </section>

            <section className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-white rounded-xl border border-cream-line p-5">
                <h2 className="font-display font-bold text-navy mb-3">Owners by subscription status</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(s.ownersByStatus).map(([status, count]) => (
                      <tr key={status} className="border-t border-cream-dim">
                        <td className="py-2 capitalize text-ink">{status.replace("_", " ")}</td>
                        <td className="py-2 text-right font-medium text-navy">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-white rounded-xl border border-cream-line p-5">
                <h2 className="font-display font-bold text-navy mb-3">Owners by tier</h2>
                <table className="w-full text-sm">
                  <tbody>
                    {["starter", "pro", "enterprise"].map((tier) => (
                      <tr key={tier} className="border-t border-cream-dim">
                        <td className="py-2 capitalize text-ink">{tier}</td>
                        <td className="py-2 text-right font-medium text-navy">{s.ownersByTier[tier] || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-xl border border-cream-line p-5">
              <h2 className="font-display font-bold text-navy mb-3">Fields</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-ink-soft text-xs uppercase tracking-wide">
                      <th className="pb-2 font-medium">Field</th>
                      <th className="pb-2 font-medium">Owner</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium text-right">Events</th>
                      <th className="pb-2 font-medium text-right">Paid bookings</th>
                      <th className="pb-2 font-medium text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.fieldRows.map((f) => (
                      <tr key={f.id} className="border-t border-cream-dim">
                        <td className="py-2 text-navy font-medium">{f.name}</td>
                        <td className="py-2 text-ink">{f.ownerName}</td>
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
                        <td className="py-2 text-right font-medium">{money(f.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-xl border border-cream-line p-5 mt-8">
              <h2 className="font-display font-bold text-navy mb-1 flex items-center gap-2">
                <Package size={16} /> Welcome package addresses
              </h2>
              <p className="text-xs text-ink-soft mb-3">
                Where to actually ship stickers, a tablet stand, etc. Private, owner-provided — separate from a
                field's public listing address, since some fields have no one on-site to receive mail. Claimed
                fields only; a blank row just means that owner hasn't filled theirs in yet.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-ink-soft text-xs uppercase tracking-wide">
                      <th className="pb-2 font-medium">Field</th>
                      <th className="pb-2 font-medium">Owner</th>
                      <th className="pb-2 font-medium">Recipient</th>
                      <th className="pb-2 font-medium">Address</th>
                      <th className="pb-2 font-medium">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.fieldRows.filter((f) => f.claimed).map((f) => {
                      const a = f.shippingAddress;
                      const hasAddress = a && (a.line1 || a.city);
                      return (
                        <tr key={f.id} className="border-t border-cream-dim align-top">
                          <td className="py-2 text-navy font-medium">{f.name}</td>
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="text-xs text-ink-soft mt-6">
              Last loaded {data.fetchedAt.toLocaleTimeString()}. "Booking fee revenue" is Atlas's own cut
              (the 10%/$3-cap fee), not the full amount players paid — most of that goes straight to field
              owners. Figures reflect Firestore, not Stripe directly, so refunds aren't backed out yet.
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
