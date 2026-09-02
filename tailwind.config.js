export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Same palette as the owner app (src/App.jsx), so this reads as
        // the same product family rather than a bolted-on tool.
        navy: "#002C48",
        cream: "#F2F2ED",
        "cream-dim": "#E7E7E1",
        "cream-line": "#D2D2CB",
        "ink-soft": "#686C72",
        ink: "#4E5257",
        accent: "#1554B8",
        positive: "#0F7A52",
        negative: "#BC3327",
      },
      fontFamily: {
        display: ["Space Grotesk", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
