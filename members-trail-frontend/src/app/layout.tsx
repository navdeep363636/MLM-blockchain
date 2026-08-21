import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "Members Trail — Play. Earn. Stake.",
    template: "%s · Members Trail",
  },
  description:
    "Skill-based gaming on BNB Smart Chain. Earn Points through gameplay, convert to MTT, stake for revenue-funded yield. Referrals are an optional, capped bonus — never required to earn.",
  applicationName: "Members Trail",
  openGraph: {
    title: "Members Trail — Play. Earn. Stake.",
    description: "Skill-based play-to-earn gaming with revenue-funded rewards on BNB Smart Chain.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14110f" },
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:bg-[var(--accent)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
