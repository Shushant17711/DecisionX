import type { Metadata, Viewport } from "next";
import { Albert_Sans, IBM_Plex_Mono } from "next/font/google";
import { StorageNotice } from "@/components/StorageNotice";
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
    // suppressHydrationWarning: browser extensions (e.g. "I don't care about
    // cookies" adds `idc0_*`) mutate <html> attributes before hydration.
    // Only silences this element's own attributes, not its children.
    <html lang="en" data-theme="decisionx" suppressHydrationWarning>
      <body className={`${albert.variable} ${plexMono.variable} min-h-dvh`}>
        {children}
        <StorageNotice />
      </body>
    </html>
  );
}
