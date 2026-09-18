import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import { activeClient } from "@config/index";
import { SessionProvider } from "@/lib/auth/SessionProvider";

import "./globals.css";

/** Interface copy and headings. */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
  display: "swap",
});

/**
 * Every data value in the app — file sizes, timestamps, S3 keys, counts.
 * The split from the sans face is structural, not decorative.
 */
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${activeClient.displayName} — Secure File Access`,
    template: `%s — ${activeClient.displayName}`,
  },
  description: `Managed S3 access portal for ${activeClient.displayName}, built and operated by Nuaig.`,
  // The portal is behind authentication and holds client data; it should never
  // appear in a search index even if a URL leaks.
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
