import { ImageResponse } from "next/og";

/*
 * Maskable variant: the OS can crop this to a circle, squircle or rounded
 * square, so the dot sits well inside the safe zone (Android's is roughly
 * the inner 80% of the canvas) instead of near the edge like the plain icon.
 */
export const dynamic = "force-static";

export async function GET() {
  const size = 512;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1813",
        }}
      >
        <div
          style={{
            width: size * 0.34,
            height: size * 0.34,
            borderRadius: "50%",
            background: "#bd5310",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
