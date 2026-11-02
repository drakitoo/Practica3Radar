import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RADAR CENTINELA | Centro de control",
  description: "Centro de monitoreo en tiempo real para RADAR CENTINELA IoT.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
