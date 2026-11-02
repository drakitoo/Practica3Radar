import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#071014",
        panel: "#0c171c",
        neon: "#a3ff6f",
        cyan: "#53d9e8",
      },
    },
  },
  plugins: [],
};

export default config;
