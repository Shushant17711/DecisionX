import type { Metadata, Viewport } from "next";
import { Albert_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Albert Sans for wordmark; IBM Plex Mono reserved for measurement.
const albert = Albert_Sans({
  variable: "--font-albert",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "DecisionX — cross-examine any idea",
  description:
    "Submit an idea and a panel of AI experts is assembled around it. Each argues its own corner; you get a scored verdict that shows exactly where they disagree.",
};

// Match browser chrome to the interface's dark theme.
export const viewport: Viewport = {
  themeColor: "#111010",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="decisionx">
      <body className={`${albert.variable} ${plexMono.variable} min-h-dvh`}>{children}</body>
    </html>
  );
}
