import { ImageResponse } from "next/og";

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
            width: size * 0.44,
            height: size * 0.44,
            borderRadius: "50%",
            background: "#bd5310",
          }}
        />
      </div>
    ),
    { width: size, height: size },
  );
}
