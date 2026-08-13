import { ImageResponse } from "next/og";

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: 192,
        height: 192,
        background: "linear-gradient(145deg, #050505 0%, #202020 100%)",
        borderRadius: 44,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <div style={{ fontSize: 80, lineHeight: 1 }}>⚽</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: "#ffffff", letterSpacing: "0.12em" }}>SV</div>
    </div>,
    { width: 192, height: 192 }
  );
}
