import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every panel page reads the session cookie and live SQLite data on each
  // request, so the Cache Components static-shell model buys nothing here.
  cacheComponents: false,
  // Native module: load it with Node's require instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
