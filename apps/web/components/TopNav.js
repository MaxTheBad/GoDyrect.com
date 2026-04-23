'use client';

import AuthNav from './AuthNav';
import { usePathname } from 'next/navigation';

export default function TopNav() {
  const pathname = usePathname();
  const isLanding = ['/', '/landing', '/about', '/contactus'].includes(pathname);

  const headerStyle = isLanding
    ? { ...wrap, background: '#06b6d4', borderBottom: 'none', backdropFilter: 'none' }
    : wrap;

  const brandTextColor = isLanding ? '#ffffff' : '#111827';

  return (
    <header style={headerStyle}>
      <div style={inner}>
        <a href='/' style={{ ...brand, color: brandTextColor }}>
          <img src='/logo.png' alt='GoDyrect' style={{width:36,height:36,objectFit:'contain',borderRadius:8}} />
          <strong style={{ fontSize: 21, color: brandTextColor, letterSpacing: '-0.01em', marginLeft:10 }}>GoDyrect</strong>
        </a>
        {isLanding ? (
          <nav style={{ display: 'flex', gap: 16 }}>
            <a href='/about' style={landingLink}>About</a>
            <a href='/contactus' style={landingLink}>Contact</a>
          </nav>
        ) : (
          <AuthNav />
        )}
      </div>
    </header>
  );
}

const wrap = {
  position: 'sticky',
  top: 0,
  zIndex: 50,
  background: 'rgba(255,255,255,0.92)',
  backdropFilter: 'blur(10px)',
  borderBottom: '1px solid #eceff5',
};

const inner = {
  maxWidth: 1120,
  margin: '0 auto',
  padding: '12px 20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
};

const brand = { display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' };
const brandIcon = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  fontWeight: 700,
  color: '#fff',
  background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 45%, #8134af 75%, #515bd4 100%)',
};

const landingLink = { color: '#ffffff', textDecoration: 'none', fontWeight: 600, padding: '8px 12px', borderRadius: 8, background: '#06b6d4' };

const linkStyle = { color: '#111827', textDecoration: 'none', fontWeight: 600 };
