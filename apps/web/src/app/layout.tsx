import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'KARAWOWKE — Hi-Fi Home KTV Deck',
  description: 'Self-hosted Raspberry Pi Home Karaoke (KTV) TV Player & Pocket Remote Deck',
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0b0a09',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..700;1,9..40,400..600&family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500;700;800&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-dvh bg-[#0b0a09] text-[#f4ede1] selection:bg-amber-500/30 selection:text-[#faf6ee]">
        {children}
      </body>
    </html>
  );
}
