import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Velo Ladder",
    short_name: "Velo Ladder",
    description: "Weighted-ball velocity tracker for pitching athletes",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f0e8",
    theme_color: "#f2f0e8",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
