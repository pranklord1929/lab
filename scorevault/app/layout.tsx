import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "ScoreVault · WC2026 Prediction League",
  description: "Predict World Cup 2026 scores, climb the leaderboard and win the pot with your friends. Free, instant, no sign-up required.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ScoreVault",
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: "ScoreVault · WC2026 Prediction League",
    description: "Predict scores, climb the leaderboard, win the pot. The World Cup 2026 prediction game for you and your crew.",
    url: "https://scorevault.org",
    siteName: "ScoreVault",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "ScoreVault · WC2026 Prediction League",
    description: "Predict scores, climb the leaderboard, win the pot.",
  },
  keywords: ["world cup 2026", "WC2026", "football predictions", "score predictor", "friend league", "sweepstake"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
