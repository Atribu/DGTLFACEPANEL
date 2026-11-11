import type { NextConfig } from "next";

const benchmarkOrigin =
  (process.env.BENCHMARK_ORIGIN ?? "http://localhost:3001").replace(/\/+$/, "");

const config: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,

  async rewrites() {
    return [
      {
        source: "/benchmark",
        destination: `${benchmarkOrigin}/benchmark`,
      },
      {
        source: "/benchmark/:path*",
        destination: `${benchmarkOrigin}/benchmark/:path*`,
      },
      {
        source: "/benchmark-static/:path*",
        destination: `${benchmarkOrigin}/benchmark-static/:path*`,
      },
    ];
  },
};

export default config;
