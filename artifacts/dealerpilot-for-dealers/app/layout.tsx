import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description = "Organiza inventario, publicaciones y compradores desde un solo lugar.";

  return {
    metadataBase: new URL(origin),
    title: "DealerPilot para dealers",
    description,
    icons: { icon: "/assets/images/favicon.png", shortcut: "/assets/images/favicon.png" },
    openGraph: {
      title: "DealerPilot | Más ventas. Menos trabajo manual.",
      description,
      type: "website",
      images: [{ url: new URL("/og.png", origin).toString(), width: 1536, height: 1024, alt: "DealerPilot para dealers" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DealerPilot | Más ventas. Menos trabajo manual.",
      description,
      images: [new URL("/og.png", origin).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
