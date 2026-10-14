import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// The favicon comes from the `icon.svg` file convention next to this layout; the page sets the per-view tab title.
export const metadata: Metadata = {
  title: "CETEM-QC · Espace responsable",
  description: "Espace Responsable CETEM-QC : planification des contrôles qualité, preuves, décisions de conformité et rapports officiels.",
  applicationName: "CETEM-QC",
};

export const viewport: Viewport = { themeColor: "#0B1F3A", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
