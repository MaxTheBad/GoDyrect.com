import TopNav from '../components/TopNav';
import Footer from '../components/Footer';
import MobileBottomNav from '../components/MobileBottomNav';
import './globals.css';

export const metadata = {
  title: { default: 'GoDyrect — Business deals, without the runaround', template: '%s | GoDyrect' },
  description: 'Discover, buy, sell, and broker businesses directly on one modern marketplace.',
  manifest: '/manifest.webmanifest',
  applicationName: 'GoDyrect',
  appleWebApp: {
    capable: true,
    title: 'GoDyrect',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        {children}
        <Footer />
        <MobileBottomNav />
      </body>
    </html>
  );
}
