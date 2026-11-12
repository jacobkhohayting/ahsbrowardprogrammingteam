import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These run only on the server and should be loaded from node_modules as-is.
  serverExternalPackages: ["@vercel/sandbox", "@vercel/oidc", "pg"],
  experimental: {
    serverActions: {
      // Test-case uploads go through forms. Vercel itself caps requests at 4.5 MB.
      bodySizeLimit: "4mb",
    },
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
