import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17211d",
        paper: "#f6f7f2",
        mint: {
          50: "#eefbf4",
          100: "#d9f6e6",
          500: "#26a768",
          600: "#188755",
          700: "#126b45",
        },
        apricot: { 100: "#fff0da", 400: "#f6a94a", 500: "#e88d20" },
      },
      boxShadow: { card: "0 12px 34px rgba(23,33,29,.07)" },
    },
  },
  plugins: [],
} satisfies Config;
