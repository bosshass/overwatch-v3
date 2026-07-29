// WARNING — this gate silently passed for weeks because eslint and
// @eslint/js were not installed: `npx eslint` died on module resolution,
// and grepping its output for "no-undef" found nothing, which reads
// exactly like success. Run it as `npm run verify` (lint THEN build) so a
// broken eslint install fails loudly instead of looking clean.
// Minimal no-undef gate. Vite builds happily ship code that references
// undefined globals — "CALENDARS is not defined" reached production tonight
// with a green build. This catches that class before packaging.
import js from "@eslint/js";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: "readonly", document: "readonly", fetch: "readonly",
                 console: "readonly", localStorage: "readonly", sessionStorage: "readonly",
                 URLSearchParams: "readonly", navigator: "readonly", alert: "readonly",
                 confirm: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
                 setInterval: "readonly", clearInterval: "readonly", Blob: "readonly",
                 URL: "readonly", FileReader: "readonly", history: "readonly",
                 location: "readonly", requestAnimationFrame: "readonly",
                 // real browser globals this app uses — listed so the gate exits
                 // clean and a genuine crash is never buried in known noise
                 caches: "readonly", Notification: "readonly", btoa: "readonly",
                 atob: "readonly", TextEncoder: "readonly", TextDecoder: "readonly",
                 AbortController: "readonly", IntersectionObserver: "readonly",
                 Image: "readonly", self: "readonly" },
    },
    // Source carries `eslint-disable-next-line react-hooks/exhaustive-deps`
    // comments. This gate doesn't load that plugin, and an unknown rule in a
    // disable directive is itself an error — so five files failed the gate for
    // a comment. Stub the rule as off: the directives resolve, the gate stays
    // minimal, and the only thing that can fail it is a real undefined symbol.
    plugins: { "react-hooks": { rules: { "exhaustive-deps": { create: () => ({}) } } } },
    rules: { "no-undef": "error", "react-hooks/exhaustive-deps": "off" },
  },
];
