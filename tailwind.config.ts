import type { Config } from "tailwindcss";

/**
 * Semantic colors resolve through CSS variables so toggling
 * data-theme="dark" on <html> rethemes every utility class.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bgpage: "var(--bg-page)",
        bgcard: "var(--bg-card)",
        bgsubtle: "var(--bg-subtle)",
        bgcode: "var(--bg-code)",
        bgnav: "var(--bg-nav)",
        ink: "var(--ink)",
        inkmuted: "var(--ink-muted)",
        inkfaint: "var(--ink-faint)",
        inkfaded: "var(--ink-muted)",
        primary: {
          DEFAULT: "var(--primary)",
          hover: "var(--primary-hover)",
          soft: "var(--primary-soft)",
        },
        success: {
          DEFAULT: "var(--success)",
          soft: "var(--success-soft)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          soft: "var(--warning-soft)",
        },
        error: {
          DEFAULT: "var(--error)",
          soft: "var(--error-soft)",
        },
        gold: {
          DEFAULT: "var(--gold)",
          soft: "var(--gold-soft)",
        },
        streak: "var(--streak)",
        sparks: "var(--sparks)",
        // Legacy aliases used by auth / start pages
        paper: "var(--bg-card)",
        paperdark: "var(--bg-subtle)",
        linen: "var(--bg-page)",
        cork: "var(--bg-subtle)",
        walnut: "var(--ink-faint)",
        terracotta: "var(--error)",
        moss: "var(--success)",
        sage: "var(--success-soft)",
        brass: "var(--warning)",
      },
      fontFamily: {
        heading: "var(--font-heading)",
        body: "var(--font-body)",
        ui: "var(--font-ui)",
        mono: "var(--font-mono)",
        hand: "var(--font-hand)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};

export default config;
