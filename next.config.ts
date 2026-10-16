import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The reset page has a live token in its URL. Real response headers, not just
   * the page's <meta>: no Referer leaves the page, and nothing caches it.
   */
  async headers() {
    return [
      {
        source: "/reset-password/:token*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
