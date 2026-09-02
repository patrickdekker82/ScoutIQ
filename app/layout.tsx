import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ScoutIQ',
  description: 'Self-hosted football scouting and analytics platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
