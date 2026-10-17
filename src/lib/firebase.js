import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getFunctions } from "firebase/functions";

// Same Firebase project as the player and owner apps — Atlas has one
// shared backend, not one per app. This portal only ever reads from it.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
// No region override -- same default (us-central1) every onCall function
// in atlas-players-app's functions/index.js already deploys to. Used only
// by the Email & signup insights page (getEmailInsights), the first Cloud
// Function this portal has ever called -- everything else here is a
// direct Firestore read/write.
export const functions = getFunctions(app);

// Must match the isAdmin() uid in atlas-players-app's firestore.rules
// exactly — that's the real enforcement. This constant only controls what
// the UI shows; a non-admin who somehow reached the dashboard would still
// have every read denied by the rules themselves.
export const ATLAS_OWNER_UID = "lg4HMLTJvsPfSEN1pvNhMV4fbct1";
