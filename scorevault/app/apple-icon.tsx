import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: 180,
        height: 180,
        background: "linear-gradient(145deg, #050505 0%, #202020 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 76, lineHeight: 1 }}>⚽</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: "#ffffff", letterSpacing: "0.12em" }}>SV</div>
    </div>,
    { width: 180, height: 180 }
  );
}
