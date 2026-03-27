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
        <HomeIcon />
        <span style={label}>Home</span>
      </a>
      <a href='/listings/new' style={{ ...item, ...center }}>
        <PlusIcon />
        <span style={{ ...label, color: '#fff' }}>Post</span>
      </a>
      <a href='/messages' style={item}>
        <MessageIcon />
        <span style={label}>Messages</span>
      </a>
    </nav>
  );
}

function IconWrap({ children }) {
  return <span style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{children}</span>;
}
function HomeIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M3 10.5 12 3l9 7.5' /><path d='M5 9.8V21h14V9.8' /></svg></IconWrap>;
}
function PlusIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 5v14M5 12h14' /></svg></IconWrap>;
}
function MessageIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z' /></svg></IconWrap>;
}

const wrap = {
  position: 'fixed',
  left: 12,
  right: 12,
  bottom: 12,
  background: 'rgba(255,255,255,0.95)',
  border: '1px solid #eceff5',
  borderRadius: 18,
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
  padding: 8,
  zIndex: 1000,
  boxShadow: '0 10px 30px rgba(17,24,39,0.12)',
};

const item = {
  textDecoration: 'none',
  color: '#111827',
  border: '1px solid #eceff5',
  borderRadius: 12,
  background: '#fff',
  display: 'grid',
  placeItems: 'center',
  padding: '8px 6px',
};

const center = {
  background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 45%, #8134af 75%, #515bd4 100%)',
  color: '#fff',
  border: '0',
};

const label = { fontSize: 11, marginTop: 4, color: '#4b5563' };
