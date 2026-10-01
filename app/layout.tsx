import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DGTLFACE · Operasyon Paneli",
  description: "Oteller, ekipler ve işler tek çalışma alanında.",
};
export const viewport: Viewport = {
  themeColor: "#140F25",
  colorScheme: "light",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
