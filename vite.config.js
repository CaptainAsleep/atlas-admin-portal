import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No PWA plugin here on purpose — this is an internal, desktop-first
// dashboard for one admin, not an installable app like the player/owner
// apps. Keeping the build plain avoids the service-worker cache-staleness
// class of bugs entirely for a tool that should always show live data.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
