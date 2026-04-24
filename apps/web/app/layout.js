import TopNav from '../components/TopNav';
import Footer from '../components/Footer';
import MobileBottomNav from '../components/MobileBottomNav';

export const metadata = {
  title: 'GoDyrect',
  description: 'Buy and sell businesses',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, Arial, sans-serif', background: '#f8fafc', color: '#111827' }}>
        <TopNav />
        {children}
        <Footer />
        <MobileBottomNav />
      </body>
    </html>
  );
}
