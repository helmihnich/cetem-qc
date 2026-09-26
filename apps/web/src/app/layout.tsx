import type { ReactNode } from "react";

export const metadata = {
  title: "CETEM-QC",
  description: "Application web CETEM-QC",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
