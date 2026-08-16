import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.MATERIA_ALLOWED_DEV_ORIGINS || "127.0.0.1")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["openai"],
  allowedDevOrigins,
  outputFileTracingExcludes: {
    "/*": [
      ".data/**/*",
      ".agents/**/*",
      ".codex/**/*",
      "docs/**/*",
      "services/**/*",
      "tests/**/*",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "design-qa.md",
    ],
  },
};

export default nextConfig;
