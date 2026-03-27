'use client';

import { useEffect, useState } from 'react';

export default function BottomNav() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  if (!isMobile) return null;

  return (
    <nav style={wrap}>
      <a href='/' style={item} aria-label='Home'>
        <span style={{ fontSize: 20 }}>🏠</span>
        <span style={label}>Home</span>
      </a>
      <a href='/listings/new' style={{ ...item, ...center }}>
        <span style={{ fontSize: 20 }}>＋</span>
        <span style={label}>Post Business</span>
      </a>
      <a href='/messages' style={item}>
        <span style={{ fontSize: 20 }}>💬</span>
        <span style={label}>Messages</span>
      </a>
    </nav>
  );
}

const wrap = {
  position: 'fixed',
  left: 12,
  right: 12,
  bottom: 12,
  background: '#101a3d',
  border: '1px solid #31437a',
  borderRadius: 16,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  padding: 8,
  zIndex: 1000,
};

const item = {
  textDecoration: 'none',
  color: '#fff',
  border: '1px solid #304178',
  borderRadius: 12,
  background: '#0e1738',
  display: 'grid',
  placeItems: 'center',
  padding: '8px 6px',
};

const center = {
  background: '#2e7dff',
  border: '1px solid #2e7dff',
};

const label = { fontSize: 11, marginTop: 4 };
