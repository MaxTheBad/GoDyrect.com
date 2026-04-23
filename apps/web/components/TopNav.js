'use client';

import AuthNav from './AuthNav';
import { usePathname } from 'next/navigation';

export default function TopNav() {
  const pathname = usePathname();
  const isLanding = pathname === '/' || pathname === '/landing';

  return (
    <header style={wrap}>
      <div style={inner}>
        <a href='/' style={brand}>
          <div style={brandIcon}>◎</div>
          <strong style={{ fontSize: 21, color: '#111827', letterSpacing: '-0.01em' }}>GoDyrect</strong>
        </a>
        {isLanding ? (
          <nav style={{ display: 'flex', gap: 12 }}>
            <a href='/about' style={linkStyle}>About</a>
            <a href='/contactus' style={linkStyle}>Contact</a>
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

const linkStyle = { color: '#111827', textDecoration: 'none', fontWeight: 600 };
