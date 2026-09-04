import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../lib/firebase";

// Real Stripe monthly price per tier — see TIER_PRICE_IDS in
// atlas-players-app/functions/index.js. Kept in sync manually since
// there's no shared package between the two repos; if pricing ever
// changes there, update it here too.
export const TIER_PRICES = { starter: 79, pro: 149, enterprise: 299 };

// Display names shown in the admin UI — kept separate from the object
// keys above and in TIER_PRICES, which must keep matching the literal
// owners.subscriptionTier values actually stored in Firestore (still
// "starter"/"pro"/"enterprise", tied to TIER_PRICE_IDS in
// atlas-players-app/functions/index.js). Per Michael's Sep 2026 pricing
// decision (see Atlas_Pricing_Reality_Check.xlsx), the plan formerly sold
// as "Starter" is now "Basic," and the old unlimited-fields "Enterprise"
// plan is now "Unlimited" (up to 3 fields, flat $350/mo) — a new, narrower
// "Enterprise" is reserved for a future 4+-field custom-pricing tier that
// doesn't exist as stored data yet, so it has no key of its own here.
// Rename a tier on screen by editing this map, not the object keys above —
// those only change once the underlying Firestore/Stripe tier keys do.
export const TIER_LABELS = { starter: "Basic", pro: "Pro", enterprise: "Unlimited" };

// The admin portal's one write path — everything else here is read-only
// by design (see atlas-status.md). Firestore rules already let the admin
// uid write fields/{fieldId}/private/{docId} (isAdmin() gets read AND
// write there, so Michael can fix a shipping-address typo without asking
// the owner to redo it — see firestore.rules) — this just piggybacks on
// that same doc rather than needing a rules change of its own. merge:true
// so this never clobbers the address fields an owner already filled in,
// and works fine even if the private/shipping doc doesn't exist yet.
export async function setWelcomePackageSent(fieldId, sent) {
  await setDoc(
    doc(db, "fields", fieldId, "private", "shipping"),
    { sent, sentAt: sent ? serverTimestamp() : null },
    { merge: true }
  );
}

// Inverts bookingFeeCents = min(round(entryPriceCents * 0.10), 300) given
// only the total amountPaidCents — same formula as createBookingCheckout,
// run backwards. Only needed as a fallback for bookings recorded before
// bookingFeeCents started being stored directly on the booking doc
// (2026-09-02); every booking from that point on has the real number.
function estimateBookingFeeCents(amountPaidCents) {
  const entryUncapped = Math.round(amountPaidCents / 1.1);
  const feeUncapped = amountPaidCents - entryUncapped;
  if (feeUncapped >= 0 && feeUncapped <= 300) return feeUncapped;
  return 300;
}

/**
 * Pulls a full snapshot of Atlas's current state for the dashboard.
 *
 * Deliberately does NOT use a collectionGroup('bookings') query — both
 * events/{id}/bookings/{uid} (the authoritative record) and
 * users/{uid}/bookings/{eventId} (a denormalized mirror for the player
 * app's own Schedule tab) are subcollections literally named "bookings",
 * so a collectionGroup query would return both shapes mixed together
 * (double-counting every real booking) and the mirror copy is guarded by
 * a narrower security rule the admin uid isn't covered by. Fetching each
 * event's own bookings subcollection directly sidesteps both problems and
 * only relies on rules already confirmed to allow this (fields/events/
 * bookings are all public-read; owners needed the one rules change).
 */
export function useAdminData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [fieldsSnap, ownersSnap, eventsSnap] = await Promise.all([
        getDocs(collection(db, "fields")),
        getDocs(collection(db, "owners")),
        getDocs(collection(db, "events")),
      ]);

      let fields = fieldsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const owners = ownersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const events = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Private, field-scoped welcome-package shipping addresses — only
      // fetched for claimed fields (an unclaimed field has no owner to
      // have filled one in). Only readable here because the admin uid is
      // explicitly allowed in firestore.rules (fields/{id}/private/{doc}),
      // unlike the fully public fields/owners/events/bookings reads above.
      const claimedFields = fields.filter((f) => f.claimed === true);
      const shippingSnaps = await Promise.all(
        claimedFields.map((f) => getDoc(doc(db, "fields", f.id, "private", "shipping")).catch(() => null))
      );
      const shippingByFieldId = {};
      claimedFields.forEach((f, i) => {
        const snap = shippingSnaps[i];
        if (snap && snap.exists()) shippingByFieldId[f.id] = snap.data();
      });
      fields = fields.map((f) => ({ ...f, shippingAddress: shippingByFieldId[f.id] || null }));

      const bookingsByEvent = await Promise.all(
        events.map((e) => getDocs(collection(db, "events", e.id, "bookings")))
      );
      const bookings = [];
      bookingsByEvent.forEach((snap, i) => {
        snap.docs.forEach((d) => bookings.push({ id: d.id, eventId: events[i].id, ...d.data() }));
      });

      setData({ fields, owners, events, bookings, fetchedAt: new Date() });
    } catch (err) {
      console.error("Admin dashboard load failed:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

/** Turns the raw snapshot from useAdminData into the numbers the dashboard shows. */
export function summarize(data) {
  if (!data) return null;
  const { fields, owners, events, bookings } = data;

  const fieldsClaimed = fields.filter((f) => f.claimed === true).length;
  const fieldsPending = fields.filter((f) => f.claimPending === true).length;

  const ownersByStatus = {};
  const ownersByTier = {};
  let payoutsEnabledCount = 0;
  let activeMRR = 0;
  let trialingCount = 0;
  let trialingPotentialMRR = 0;

  for (const o of owners) {
    const status = o.subscriptionStatus || "none";
    ownersByStatus[status] = (ownersByStatus[status] || 0) + 1;
    if (o.subscriptionTier) {
      ownersByTier[o.subscriptionTier] = (ownersByTier[o.subscriptionTier] || 0) + 1;
    }
    if (o.payoutsEnabled) payoutsEnabledCount += 1;

    const tierPrice = TIER_PRICES[o.subscriptionTier] || 0;
    if (status === "active") activeMRR += tierPrice;
    if (status === "trialing") {
      trialingCount += 1;
      trialingPotentialMRR += tierPrice;
    }
  }

  const paidBookings = bookings.filter((b) => b.paid === true);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const paidBookingsThisMonth = paidBookings.filter((b) => {
    const bookedAt = b.bookedAt?.toDate ? b.bookedAt.toDate() : b.bookedAt ? new Date(b.bookedAt) : null;
    return bookedAt && bookedAt >= monthStart;
  });

  // payoutRevenueCents is the complement of bookingFeeRevenueCents — the
  // share of each paid booking that goes to the field owner rather than
  // Atlas (amountPaidCents minus the fee), matching how the Stripe Connect
  // destination charge actually splits the money in createBookingCheckout
  // (application_fee_amount to Atlas, the rest to transfer_data.destination).
  // Both totals are computed in the same pass since they need the same fee
  // figure per booking (exact when bookingFeeCents was recorded, estimated
  // via estimateBookingFeeCents otherwise).
  let bookingFeeRevenueCents = 0;
  let payoutRevenueCents = 0;
  let estimatedFeeCount = 0;
  for (const b of paidBookings) {
    let feeCents = null;
    if (typeof b.bookingFeeCents === "number") {
      feeCents = b.bookingFeeCents;
    } else if (typeof b.amountPaidCents === "number") {
      feeCents = estimateBookingFeeCents(b.amountPaidCents);
      estimatedFeeCount += 1;
    }
    if (feeCents == null) continue; // neither field present — can't count this booking either way
    bookingFeeRevenueCents += feeCents;
    if (typeof b.amountPaidCents === "number") {
      payoutRevenueCents += b.amountPaidCents - feeCents;
    }
  }

  const upcomingEvents = events.filter((e) => {
    const d = e.date?.toDate ? e.date.toDate() : e.date ? new Date(e.date) : null;
    return d && d >= now && !e.canceled && !e.deleted;
  });

  const fieldRows = fields.map((f) => {
    const owner = owners.find((o) => o.id === f.ownerId);
    const fieldEvents = events.filter((e) => e.fieldId === f.id);
    const fieldEventIds = new Set(fieldEvents.map((e) => e.id));
    const fieldPaidBookings = paidBookings.filter((b) => fieldEventIds.has(b.eventId));
    const revenueCents = fieldPaidBookings.reduce((sum, b) => {
      if (typeof b.bookingFeeCents === "number") return sum + b.bookingFeeCents;
      if (typeof b.amountPaidCents === "number") return sum + estimateBookingFeeCents(b.amountPaidCents);
      return sum;
    }, 0);
    return {
      id: f.id,
      name: f.name || f.id,
      claimed: f.claimed === true,
      claimPending: f.claimPending === true,
      ownerName: owner?.name || owner?.email || (f.claimed ? "(owner record missing)" : "—"),
      eventsCount: fieldEvents.length,
      paidBookingsCount: fieldPaidBookings.length,
      revenueCents,
      subscriptionStatus: owner?.subscriptionStatus || null,
      payoutsEnabled: owner?.payoutsEnabled === true,
      shippingAddress: f.shippingAddress || null,
    };
  });

  return {
    fieldsTotal: fields.length,
    fieldsClaimed,
    fieldsPending,
    ownersTotal: owners.length,
    ownersByStatus,
    ownersByTier,
    payoutsEnabledCount,
    activeMRR,
    trialingCount,
    trialingPotentialMRR,
    eventsTotal: events.length,
    upcomingEventsCount: upcomingEvents.length,
    paidBookingsTotal: paidBookings.length,
    paidBookingsThisMonth: paidBookingsThisMonth.length,
    bookingFeeRevenueCents,
    payoutRevenueCents,
    // "Total Atlas revenue" per Michael: all-time booking fees plus this
    // month's active subscription revenue. Not a true lifetime total —
    // Firestore has no historical ledger of past subscription payments,
    // only each owner's current tier/status — so this is booking fees
    // (exact, cumulative) blended with a current-month recurring snapshot,
    // not two numbers on the same time basis.
    totalAtlasRevenueCents: bookingFeeRevenueCents + Math.round(activeMRR * 100),
    estimatedFeeCount,
    fieldRows: fieldRows.sort((a, b) => b.revenueCents - a.revenueCents),
  };
}
