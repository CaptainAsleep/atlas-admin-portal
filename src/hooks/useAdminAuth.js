import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut } from "firebase/auth";
import { auth, ATLAS_OWNER_UID } from "../lib/firebase";

// Deliberately no sign-up flow — this app has exactly one intended user
// (Michael), who already has a Firebase Auth account from the owner app
// (same Firebase project, shared user pool). Signing in here just reuses
// that existing login.
export function useAdminAuth() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  async function signIn(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signOut() {
    await firebaseSignOut(auth);
  }

  // UI-level gate only, for a clean "not authorized" screen instead of a
  // confusing wall of permission-denied errors. The real enforcement is
  // isAdmin() in atlas-players-app's firestore.rules, checking this same
  // uid — a signed-in non-admin who bypassed this check would still have
  // every owners/ read denied server-side.
  const isAdmin = user?.uid === ATLAS_OWNER_UID;

  return { user, authLoading, isAdmin, signIn, signOut };
}
