import type { Metadata, Viewport } from "next";
import DeviceInfo from "@/components/ui/DeviceInfo";
import PerformanceTracker from "@/components/PerformanceTracker";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quidditch Academy - Magical Sports Game",
  description: "Enter the wizarding world of Quidditch. Play solo or team matches, unlock achievements, and compete with wizards worldwide.",
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Quidditch Academy',
  },
  manifest: '/manifest.json', // PWA manifest
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5, // Allow zoom for accessibility, but prevent accidental pinch zoom during gameplay
  userScalable: true,
  themeColor: '#0f172a', // slate-900 for mobile browser chrome
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <head>
        {/* Critical Resource Hints for Maximum Performance */}
        
        {/* DNS Prefetch - Resolve DNS early */}
        <link rel="dns-prefetch" href="https://supabase.co" />
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        
        {/* Preconnect - Establish connections early */}
        <link rel="preconnect" href="https://supabase.co" crossOrigin="anonymous" />
        
        {/* Preload Critical Assets */}
        <link rel="preload" href="/quid.webp" as="image" type="image/webp" />
        <link rel="preload" href="/snitch.webp" as="image" type="image/webp" />
      </head>
      <body className="min-h-full flex flex-col">
        <PerformanceTracker />
        <DeviceInfo />
        {children}
      </body>
    </html>
  );
}
