import { useCallback, useEffect, useState } from "react";
import { addDoc, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";

// Atlas Standard has no subscription tiers anymore (removed 2026-09) —
// every owner is $0/month, revenue is entirely the per-ticket platform
// fee. Display labels for the fee-model split live inline below, next to
// where they're actually used (ownersByFeeModel).
export const FEE_MODEL_LABELS = { pass_to_player: "Pass to Player", absorb: "Absorb as Field" };

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

// Approve a pending field claim (fields/{fieldId}.claimPending === true),
// granting ownership to whoever requested it. This relies on the isAdmin()
// write grant just added to fields/{fieldId} in firestore.rules — this
// writes the field doc directly, unlike setWelcomePackageSent above which
// only ever touched the private/shipping subdoc.
//
// Note: unlike a normal self-serve claim (see claimField() in
// atlas-owners-app), this does NOT increment the owner's
// claimedFieldCount — that would require also granting isAdmin() a write
// path on owners/{ownerId} in firestore.rules, which felt like more surface
// area than this small fix warranted. Accepted as a minor, known
// inconsistency rather than expanding the rules further.
export async function approveFieldClaim(fieldId, requestedByUid) {
  await updateDoc(doc(db, "fields", fieldId), {
    ownerId: requestedByUid,
    claimed: true,
    claimVerification: "manual",
    claimPending: false,
    claimRequestedBy: null,
    claimRequestedByEmail: null,
  });
}

// Reject a pending field claim — clears the request and leaves the field
// unclaimed so it (or a corrected claim) can be requested again later.
export async function rejectFieldClaim(fieldId) {
  await updateDoc(doc(db, "fields", fieldId), {
    claimPending: false,
    claimRequestedBy: null,
    claimRequestedByEmail: null,
  });
}

// Manually filling in / correcting a field's public listing info (address,
// phone, website, socials, indoor/outdoor, the about blurb) — for when
// Michael has better info than whatever the original scrape found, or the
// scrape found nothing at all. Takes only the editable subset from
// FieldModal's edit form; an empty string is saved as null so a field can
// be cleared, not just filled in.
export async function updateFieldInfo(fieldId, updates) {
  await updateDoc(doc(db, "fields", fieldId), updates);
}

// Michael's own free-form tracking notes about a field (follow-up calls,
// claim history, anything worth remembering) — separate from the
// per-field statusNotes captured during the seed-data pass, and admin-
// only per firestore.rules (fields/{fieldId}/adminNotes/{noteId}), unlike
// private/{docId} above which the field's own owner can also read/write.
// Fetched on demand (when the field detail modal opens), not eagerly with
// the rest of the dashboard — no reason to pay for a read per field on
// every refresh for a feature only used occasionally.
// Live Resend email stats for the Email & signup insights page
// (EmailInsightsPage.jsx) -- calls the getEmailInsights Cloud Function
// (atlas-players-app/functions/index.js), which holds the RESEND_API_KEY
// secret server-side; nothing Resend-related can run in this browser.
// Fetched only when that page is actually opened, same "don't pay for it
// unless someone's looking" shape as getFieldNotes below.
export async function getEmailInsights() {
  const call = httpsCallable(functions, "getEmailInsights");
  const result = await call();
  return result.data;
}

// Admin portal #feedback (FeedbackPage.jsx) -- post-event feedback
// responses with callsigns, via the admin-gated getAdminFeedback callable.
export async function getAdminFeedback() {
  const call = httpsCallable(functions, "getAdminFeedback");
  const result = await call();
  return result.data;
}

export async function getFieldNotes(fieldId) {
  const snap = await getDocs(
    query(collection(db, "fields", fieldId, "adminNotes"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addFieldNote(fieldId, text) {
  await addDoc(collection(db, "fields", fieldId, "adminNotes"), {
    text,
    createdAt: serverTimestamp(),
  });
}

// Grants a catalog patch (an achievementPatches entry) to a player from
// the admin portal's Players section — for the ones the codebase's own
// seed script already flags as needing "a human, not a rule" (trigger:
// null: Bug Hunter, Ambassador, Secret Agent, etc.), instead of doing it
// by hand through the Firebase console. Deliberately mirrors grantPatch
// in atlas-players-app's src/hooks/usePatches.js exactly — same doc
// shape, same read-before-write idempotency check — so a patch granted
// from here is indistinguishable from one the player app granted itself,
// and granting an already-owned catalog patch is a safe no-op rather than
// a duplicate. patch.id is the catalog doc's own id (already the correct
// slug), not re-derived from the name.
export async function grantPatchToPlayer(uid, patch) {
  const ref = doc(db, "users", uid, "patches", patch.id);
  const existing = await getDoc(ref);
  if (existing.exists()) return { alreadyOwned: true };
  await setDoc(ref, {
    name: patch.name,
    imageUrl: patch.imageUrl,
    details: patch.details || null,
    addedAt: serverTimestamp(),
    granted: true,
    seen: false,
  });
  return { alreadyOwned: false };
}

// Counterpart to grantPatchToPlayer. Deletes the player's own patch doc by
// its real doc id (the id from users/{uid}/patches, which for self-earned
// patches is a slug of the name, not necessarily the catalog id).
// firestore.rules already allow isAdmin() to write (incl. delete) there.
// Caveat: the player app re-grants automatically on next open any patch the
// player still qualifies for (a catalog entry with a trigger, or an event's
// check-in reward), so removal only sticks for hand-granted patches unless
// the qualifying data changes too.
export async function removePatchFromPlayer(uid, patchDocId) {
  await deleteDoc(doc(db, "users", uid, "patches", patchDocId));
}

// Sets an owner's fee model directly from the admin portal — feeModel is
// self-serve-locked once an owner sets it themselves (see firestore.rules
// on owners/{ownerId}: no further owner-client write may ever touch it
// again), so a real change was already a rare, manually-handled case
// (previously Firebase console/Discord). This is that same rare case with
// a real UI instead. Firestore rules enforce the "only this key" scoping
// server-side too — this function itself has no special privilege beyond
// what isAdmin() already grants there.
export async function updateOwnerFeeModel(ownerId, feeModel) {
  await updateDoc(doc(db, "owners", ownerId), { feeModel });
}

// Inverts bookingFeeCents = min(round(entryPriceCents * 0.10), 300) given
// only the total amountPaidCents — same formula as createBookingCheckout,
// run backwards. Only needed as a fallback for bookings recorded before
// bookingFeeCents started being stored directly on the booking doc
// (2026-09-02); every booking from that point on has the real number.
function estimateBookingFeeCents(amountPaidCents) {
  // Only ever a fallback for a paid booking somehow missing
  // bookingFeeCents outright (shouldn't happen going forward — the
  // webhook always writes it) — reverse-engineers Atlas Standard's fee
  // (3.5% + $1.30, capped at $5.00) assuming the pass-to-player fee
  // model, since amountPaidCents alone can't tell an "absorb" booking's
  // smaller entry price apart from a genuinely cheaper ticket.
  const entryUncapped = Math.round((amountPaidCents - 130) / 1.035);
  const feeUncapped = amountPaidCents - entryUncapped;
  if (feeUncapped >= 0 && feeUncapped <= 500) return feeUncapped;
  return 500;
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

      // Players/Teams/Patches received are newer, additive stats — each
      // caught individually (rather than inside the Promise.all above) so
      // a permissions problem on any one of them can't take the ENTIRE
      // dashboard down the way it did when they were unguarded (a real
      // "Missing or insufficient permissions" hit here on 2026-09-06,
      // most likely stale/undeployed Firestore rules relative to this
      // repo's assumptions — the rules file text does grant public read on
      // all three of these, but that only matters once actually deployed).
      // null means "couldn't load," not "zero" — kept distinct from 0 all
      // the way to the UI rather than silently showing a wrong count.
      const [playersSnap, teamsSnap, patchesSnap, usersSnap, achievementSnap] = await Promise.all([
        // publicProfiles, not users — the admin uid has no read grant on
        // users/{uid} itself (each player's own private doc, self-access
        // only), but every account gets a publicProfiles/{uid} mirror at
        // signup (self-healing for older accounts too — see useAuth.js),
        // and that collection is fully public-read. Counting it is an
        // exact player count, not an estimate, with no rules change needed.
        getDocs(collection(db, "publicProfiles")).catch((err) => {
          console.error("publicProfiles load failed:", err);
          return null;
        }),
        getDocs(collection(db, "teams")).catch((err) => {
          console.error("teams load failed:", err);
          return null;
        }),
        // A collectionGroup query, not a per-user fetch — safe here (unlike
        // the "bookings" collectionGroup this file deliberately avoids
        // above) because "patches" only ever exists as users/{uid}/patches;
        // no other subcollection anywhere shares that name to collide with.
        getDocs(collectionGroup(db, "patches")).catch((err) => {
          console.error("patches load failed:", err);
          return null;
        }),
        // Full users/{uid} collection — only readable here because
        // isAdmin() was added to that rule 2026-09-28, specifically so the
        // admin portal's Players section can show an email address
        // alongside each publicProfiles row (which deliberately never
        // carries one). Nothing else on this doc is surfaced anywhere.
        getDocs(collection(db, "users")).catch((err) => {
          console.error("users load failed:", err);
          return null;
        }),
        // The catalog of grantable patches (achievementPatches) — already
        // public-read, no rules change needed. Feeds the Players section's
        // "grant a patch" list.
        getDocs(collection(db, "achievementPatches")).catch((err) => {
          console.error("achievementPatches load failed:", err);
          return null;
        }),
      ]);
      const playersTotal = playersSnap ? playersSnap.size : null;
      const teamsTotal = teamsSnap ? teamsSnap.size : null;
      const patchesTotal = patchesSnap ? patchesSnap.size : null;

      // Group each patch doc by the uid it belongs to (a collectionGroup
      // result doesn't carry that directly — it's the second segment up
      // from the doc's own ref) and pair each player up with their email,
      // for the Players section below. Both are best-effort: a null snap
      // (permissions hiccup, rules not yet deployed) just means every
      // player shows no email / no patches rather than the section
      // failing outright, same defensive shape as playersTotal etc. above.
      const patchesByUid = {};
      if (patchesSnap) {
        patchesSnap.docs.forEach((d) => {
          const uid = d.ref.parent.parent?.id;
          if (!uid) return;
          if (!patchesByUid[uid]) patchesByUid[uid] = [];
          patchesByUid[uid].push({ id: d.id, ...d.data() });
        });
      }
      const emailByUid = {};
      // completedOnboarding and welcomeEmailSentAt feed the Email &
      // signup insights page's conversion funnel (EmailInsightsPage.jsx)
      // -- both already exist on this same users/{uid} doc (see
      // sendPlayerWelcomeEmail and the completedOnboarding gate in the
      // player app's own useAuth.js), so this is free given the fetch
      // above already happens for email. Not exposed anywhere else.
      const onboardingByUid = {};
      const welcomeEmailSentAtByUid = {};
      if (usersSnap) {
        usersSnap.docs.forEach((d) => {
          const u = d.data();
          emailByUid[d.id] = u.email || null;
          onboardingByUid[d.id] = u.completedOnboarding === true;
          welcomeEmailSentAtByUid[d.id] = u.welcomeEmailSentAt || null;
        });
      }
      const achievementCatalog = achievementSnap
        ? achievementSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
        : [];
      const players = playersSnap
        ? playersSnap.docs.map((d) => {
            const p = d.data();
            const patches = (patchesByUid[d.id] || []).sort(
              (a, b) => (b.addedAt?.toMillis?.() || 0) - (a.addedAt?.toMillis?.() || 0)
            );
            return {
              uid: d.id,
              callsign: p.callsign || "Player",
              avatarUrl: p.avatarUrl || null,
              teamName: p.teamName || null,
              verified: p.verified === true,
              referralCount: p.referralCount || 0,
              createdAt: p.createdAt || null,
              email: emailByUid[d.id] || null,
              completedOnboarding: onboardingByUid[d.id] === true,
              welcomeEmailSentAt: welcomeEmailSentAtByUid[d.id] || null,
              patches,
              patchCount: patches.length,
            };
          })
        : [];

      // Welcome-package send status. Through 2026-09 this was fulfillment
      // mail (stickers, tablet stand) shipped to a field's owner-provided
      // address AFTER they signed up, so it was only fetched for claimed
      // fields. As of 2026-09-23 the welcome package doubles as a cold
      // mailer sent to UNCLAIMED fields to get them to sign up in the
      // first place, so this is now fetched for every field. The doc
      // still lives at private/shipping (reusing the existing isAdmin()
      // grant there rather than standing up new rules) and can still hold
      // an owner-provided address from the old flow, but only sent/sentAt
      // are read here now — the cold-mailer target address comes from the
      // field's own public address/city instead (see fieldRows below).
      const shippingSnaps = await Promise.all(
        fields.map((f) => getDoc(doc(db, "fields", f.id, "private", "shipping")).catch(() => null))
      );
      const welcomePackageByFieldId = {};
      fields.forEach((f, i) => {
        const snap = shippingSnaps[i];
        if (snap && snap.exists()) welcomePackageByFieldId[f.id] = snap.data();
      });
      fields = fields.map((f) => ({ ...f, welcomePackageStatus: welcomePackageByFieldId[f.id] || null }));

      const bookingsByEvent = await Promise.all(
        events.map((e) => getDocs(collection(db, "events", e.id, "bookings")))
      );
      const bookings = [];
      bookingsByEvent.forEach((snap, i) => {
        snap.docs.forEach((d) => bookings.push({ id: d.id, eventId: events[i].id, ...d.data() }));
      });

      setData({
        fields,
        owners,
        events,
        bookings,
        playersTotal,
        teamsTotal,
        patchesTotal,
        players,
        achievementCatalog,
        fetchedAt: new Date(),
      });
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
  const { fields, owners, events, bookings, playersTotal, teamsTotal, patchesTotal, players } = data;

  // Same three statuses the player app now hides from Home/team-picker
  // listings as of the 2026-09-07/08 field data-quality pass (seed-data.mjs
  // "update fields", src/App.jsx) — a field marked "closed" (confirmed shut
  // down or sold), "no-airsoft" (an operating business, e.g. paintball-
  // only, that just never ran airsoft), or "relocated" isn't a real,
  // biddable field anymore. Excluded from the headline counts below so
  // "Fields claimed" reflects fields that could actually still be claimed,
  // not a total padded with dead listings — but NOT excluded from
  // fieldRows/the Fields table itself, since Michael's own notes on why
  // each one is inactive are exactly the kind of thing an admin dashboard
  // (unlike the player-facing app) should keep visible, not hide.
  const INACTIVE_FIELD_STATUSES = ["closed", "no-airsoft", "relocated"];
  const activeFields = fields.filter((f) => !INACTIVE_FIELD_STATUSES.includes(f.status));
  const fieldsInactive = fields.length - activeFields.length;
  const fieldsClaimed = activeFields.filter((f) => f.claimed === true).length;
  const fieldsPending = activeFields.filter((f) => f.claimPending === true).length;

  const ownersByFeeModel = {};
  let payoutsEnabledCount = 0;

  for (const o of owners) {
    const feeModel = o.feeModel || "unset";
    ownersByFeeModel[feeModel] = (ownersByFeeModel[feeModel] || 0) + 1;
    if (o.payoutsEnabled) payoutsEnabledCount += 1;
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

  // interestCount is a denormalized, client-maintained counter that goes up
  // or down as players favorite/unfavorite an event (see toggleFavorite in
  // useFavorites.js) — already sitting on each event doc we've already
  // fetched, so this is a live snapshot ("currently saved") summed with no
  // extra Firestore read, not a cumulative "ever saved" total.
  const savedEventsTotal = events.reduce((sum, e) => sum + (e.interestCount || 0), 0);

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
      claimRequestedBy: f.claimRequestedBy || null,
      claimRequestedByEmail: f.claimRequestedByEmail || null,
      ownerName: owner?.name || owner?.email || (f.claimed ? "(owner record missing)" : "—"),
      ownerEmail: owner?.email || null,
      // Needed to write feeModel back onto the right owner doc — feeModel
      // lives on owners/{ownerId}, not the field itself, so the field
      // detail modal's fee-model control needs this even though nothing
      // else in fieldRows did.
      ownerId: f.ownerId || null,
      eventsCount: fieldEvents.length,
      paidBookingsCount: fieldPaidBookings.length,
      revenueCents,
      feeModel: owner?.feeModel || null,
      payoutsEnabled: owner?.payoutsEnabled === true,
      welcomePackageStatus: f.welcomePackageStatus || null,
      // "active" covers both an explicit status: "active" and a field with
      // no status set at all (older seed rows from before this field
      // existed) — absence has never meant "inactive" in this schema.
      status: f.status || "active",
      statusNotes: f.notes || null,
      // Everything below already exists on the raw fields/{id} doc (see
      // scripts/seed-data.mjs in atlas-players-app) but was never surfaced
      // anywhere in the admin portal until the field detail modal needed
      // it — carried straight through, no computation.
      city: f.city || null,
      address: f.address || null,
      phone: f.phone || null,
      website: f.website || null,
      indoorOutdoor: f.indoorOutdoor || null,
      about: f.about || null,
      facebook: f.facebook || null,
      instagram: f.instagram || null,
      discord: f.discord || null,
      youtube: f.youtube || null,
      ownerEmailDomain: f.ownerEmailDomain || null,
      dataSource: f.dataSource || null,
      lastScraped: f.lastScraped || null,
    };
  });

  // Player email by uid, built from the already-fetched `players` list
  // (itself already paired with email via the users/{uid} fetch in
  // useAdminData — see the comment there) rather than a new lookup.
  const emailByUid = Object.fromEntries((players || []).map((p) => [p.uid, p.email || null]));

  // One row per booking, across every event — `bookings` already holds
  // every events/{eventId}/bookings/{uid} doc (see bookingsByEvent in
  // useAdminData above), so this is pure join/shaping, no new reads.
  // Deliberately NOT filtered to paidBookings — free bookings belong in
  // this table too.
  const bookingRows = bookings.map((b) => {
    const event = events.find((e) => e.id === b.eventId) || null;
    const field = fields.find((f) => f.id === b.fieldId) || null;
    const minors = Array.isArray(b.attendees) ? b.attendees.filter((a) => a?.kind === "minor") : [];
    // Display-only reference, never stored in Firestore — see
    // atlas-status.md. A paid booking's code is traceable to the real
    // Stripe Checkout Session in the Stripe dashboard; a free booking
    // (no Stripe session at all) falls back to a short hash of the
    // event/uid pair, just enough to tell two rows apart at a glance.
    const bookingRef = b.stripeCheckoutSessionId
      ? b.stripeCheckoutSessionId.slice(-8).toUpperCase()
      : `${(b.eventId || "").slice(-4)}${(b.uid || "").slice(-4)}`.toUpperCase();
    // "not_tracked" covers every booking made before the Cloud Functions
    // change that started writing these two fields — deliberately never
    // shown as "failed" just because it predates tracking.
    const emailStatus = b.confirmationEmailSentAt
      ? "sent"
      : b.confirmationEmailError
      ? "failed"
      : "not_tracked";
    return {
      id: `${b.eventId}_${b.uid}`,
      eventId: b.eventId,
      uid: b.uid,
      callsign: b.callsign || "Player",
      avatarUrl: b.avatarUrl || null,
      email: emailByUid[b.uid] || null,
      fieldId: b.fieldId || null,
      fieldName: field?.name || field?.id || "—",
      eventTitle: event?.title || "—",
      eventDate: event?.date || null,
      bookedAt: b.bookedAt || null,
      paid: b.paid === true,
      amountPaidCents: typeof b.amountPaidCents === "number" ? b.amountPaidCents : null,
      selectedChoiceLabel: b.selectedChoiceLabel || null,
      selectedRentals: Array.isArray(b.selectedRentals) ? b.selectedRentals : [],
      attendeeCount: b.attendeeCount || 1,
      minorCallsigns: minors.map((m) => m.callsign || "Child"),
      partyLabel: minors.length === 0
        ? "Solo"
        : `Party of ${1 + minors.length}`,
      emailStatus,
      confirmationEmailError: b.confirmationEmailError || null,
      bookingRef,
      stripeCheckoutSessionId: b.stripeCheckoutSessionId || null,
    };
  });

  // ---- Email & signup insights (EmailInsightsPage.jsx): the Firestore
  // half of that page -- the account-to-booking conversion funnel. Pure
  // computation over data already in hand (players, bookingRows, which
  // already carries fieldName/eventTitle/paid per booking) -- no new
  // Firestore reads. The Resend-only half (email volume/delivery by day
  // and type) comes from the getEmailInsights Cloud Function instead,
  // called directly by that page -- see getEmailInsights() above.
  //
  // Deliberately no test-account exclusion here (the one-off dashboard
  // this replaces hand-excluded "two test accounts," but there's no
  // isTestAccount flag or anything like it anywhere in the schema to do
  // that automatically) -- every real publicProfiles doc counts.
  const toMillis = (v) => {
    if (!v) return null;
    if (typeof v.toMillis === "function") return v.toMillis();
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  };

  // Earliest booking per uid, across every booking (paid or free).
  const firstBookingByUid = {};
  for (const b of bookingRows) {
    const bt = toMillis(b.bookedAt);
    if (bt == null) continue;
    const existing = firstBookingByUid[b.uid];
    if (!existing || bt < existing.bookedAtMs) {
      firstBookingByUid[b.uid] = { ...b, bookedAtMs: bt };
    }
  }

  const bookers = [];
  for (const p of players) {
    const first = firstBookingByUid[p.uid];
    const createdMs = toMillis(p.createdAt);
    if (!first || createdMs == null) continue;
    const welcomeMs = toMillis(p.welcomeEmailSentAt);
    bookers.push({
      uid: p.uid,
      callsign: p.callsign,
      createdAt: p.createdAt,
      booked: first.bookedAt,
      bookedAtMs: first.bookedAtMs,
      lagMin: (first.bookedAtMs - createdMs) / 60000,
      // null, not 0, when there's no welcome-email timestamp to compare
      // against (e.g. an account repaired by scripts/repair-missing-user-docs.mjs,
      // which deliberately leaves this unset) -- never a false "booked
      // before the welcome email even went out."
      welcomeLagMin: welcomeMs != null ? (first.bookedAtMs - welcomeMs) / 60000 : null,
      field: first.fieldName,
      event: first.eventTitle,
      paid: first.paid,
    });
  }
  bookers.sort((a, b) => a.lagMin - b.lagMin);

  const LAG_BUCKETS = [
    { label: "Under 5 min", min: -Infinity, max: 5 },
    { label: "5–15 min", min: 5, max: 15 },
    { label: "15 min–1 hr", min: 15, max: 60 },
    { label: "1–24 hr", min: 60, max: 1440 },
    { label: "1–7 days", min: 1440, max: 10080 },
    { label: "Over 7 days", min: 10080, max: Infinity },
  ];
  const buckets = LAG_BUCKETS.map((lb) => {
    const inBucket = bookers.filter((x) => x.lagMin > lb.min && x.lagMin <= lb.max);
    return { label: lb.label, count: inBucket.length, ids: inBucket.map((x) => x.uid) };
  });

  // Detroit-time day key, same convention as the players-app Cloud
  // Functions use for Detroit-local formatting elsewhere.
  const dayKeyDetroit = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Detroit" });
  const signupDays = {};
  for (const p of players) {
    const ms = toMillis(p.createdAt);
    if (ms == null) continue;
    const k = dayKeyDetroit(ms);
    signupDays[k] = (signupDays[k] || 0) + 1;
  }
  const bookingDays = {};
  for (const b of bookers) {
    const k = dayKeyDetroit(b.bookedAtMs);
    bookingDays[k] = (bookingDays[k] || 0) + 1;
  }
  // Noon UTC per step, not midnight -- immune to the Detroit DST
  // transition landing a stepped timestamp on the wrong calendar day.
  const daily = [];
  if (players.length) {
    const minMs = Math.min(...players.map((p) => toMillis(p.createdAt)).filter((x) => x != null));
    const todayKey = dayKeyDetroit(Date.now());
    let cursor = new Date(`${dayKeyDetroit(minMs)}T12:00:00Z`);
    for (let guard = 0; guard < 2000; guard++) {
      const k = cursor.toISOString().slice(0, 10);
      daily.push({ d: k, signups: signupDays[k] || 0, bookings: bookingDays[k] || 0 });
      if (k === todayKey) break;
      cursor = new Date(cursor.getTime() + 86400000);
    }
  }

  const realAccounts = players.length;
  const onboardedCount = players.filter((p) => p.completedOnboarding).length;
  const lagValues = bookers.map((b) => b.lagMin).sort((a, b) => a - b);
  const medianLag = lagValues.length
    ? (lagValues.length % 2
        ? lagValues[(lagValues.length - 1) / 2]
        : (lagValues[lagValues.length / 2 - 1] + lagValues[lagValues.length / 2]) / 2)
    : null;

  const insights = {
    realAccounts,
    onboarded: onboardedCount,
    bookers: bookers.length,
    medianLag,
    within10: bookers.filter((b) => b.lagMin <= 10).length,
    within60: bookers.filter((b) => b.lagMin <= 60).length,
    within24h: bookers.filter((b) => b.lagMin <= 1440).length,
    over7d: bookers.filter((b) => b.lagMin > 10080).length,
    onboardedNotBooked: onboardedCount - bookers.length,
    buckets,
    daily,
    bookerList: bookers,
  };

  return {
    fieldsTotal: activeFields.length,
    fieldsClaimed,
    fieldsPending,
    fieldsInactive,
    ownersTotal: owners.length,
    ownersByFeeModel,
    payoutsEnabledCount,
    eventsTotal: events.length,
    upcomingEventsCount: upcomingEvents.length,
    paidBookingsTotal: paidBookings.length,
    paidBookingsThisMonth: paidBookingsThisMonth.length,
    bookingFeeRevenueCents,
    payoutRevenueCents,
    playersTotal,
    teamsTotal,
    patchesTotal,
    savedEventsTotal,
    // "Total Atlas revenue" — with the flat subscription tiers gone,
    // Atlas's entire revenue is the per-ticket platform fee, so this is
    // just bookingFeeRevenueCents today. Kept as its own named field
    // (rather than inlining bookingFeeRevenueCents at the call site)
    // since Atlas Major will add its own flat-fee revenue here once it
    // ships, without every caller needing to know that.
    totalAtlasRevenueCents: bookingFeeRevenueCents,
    estimatedFeeCount,
    fieldRows: fieldRows.sort((a, b) => b.revenueCents - a.revenueCents),
    // Newest signups first — matches the recency-first read Michael
    // actually wants here (who just joined), unlike fieldRows above
    // which sorts by "most revenue-relevant." Search on top of this in
    // Dashboard handles specific lookups regardless of sort order.
    playerRows: (players || []).slice().sort(
      (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    ),
    // Newest-first — "recent bookings" is the default read, search in
    // Dashboard covers any specific lookup regardless of sort order.
    bookingRows: bookingRows.sort((a, b) => {
      const at = a.bookedAt?.toMillis?.() || (a.bookedAt ? new Date(a.bookedAt).getTime() : 0);
      const bt = b.bookedAt?.toMillis?.() || (b.bookedAt ? new Date(b.bookedAt).getTime() : 0);
      return bt - at;
    }),
    insights,
  };
}
