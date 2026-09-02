import { useCallback, useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";

// Real Stripe monthly price per tier — see TIER_PRICE_IDS in
// atlas-players-app/functions/index.js. Kept in sync manually since
// there's no shared package between the two repos; if pricing ever
// changes there, update it here too.
export const TIER_PRICES = { starter: 79, pro: 149, enterprise: 299 };

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

      const fields = fieldsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const owners = ownersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const events = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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

  let bookingFeeRevenueCents = 0;
  let estimatedFeeCount = 0;
  for (const b of paidBookings) {
    if (typeof b.bookingFeeCents === "number") {
      bookingFeeRevenueCents += b.bookingFeeCents;
    } else if (typeof b.amountPaidCents === "number") {
      bookingFeeRevenueCents += estimateBookingFeeCents(b.amountPaidCents);
      estimatedFeeCount += 1;
    }
  }

  const upcomingEvents = events.filter((e) => {
    const d = e.date?.toDate ? e.date.toDate() : e.date ? new Date(e.date) : null;
    return d && d >= now && !e.canceled;
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
    estimatedFeeCount,
    fieldRows: fieldRows.sort((a, b) => b.revenueCents - a.revenueCents),
  };
}
