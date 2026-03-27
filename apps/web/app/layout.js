import BottomNav from '../components/BottomNav';
import TopNav from '../components/TopNav';

export const metadata = {
  title: 'GoDyrect',
  description: 'Buy and sell businesses',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, Arial, sans-serif', background: '#f8fafc', color: '#111827', paddingBottom: 84 }}>
        <TopNav />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
