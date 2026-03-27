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
      <a href='/feed' style={item} aria-label='Feed'>
        <FeedIcon />
        <span style={label}>Feed</span>
      </a>
      <a href='/explore' style={item} aria-label='Explore'>
        <HomeIcon />
        <span style={label}>Explore</span>
      </a>
      <a href='/favorites' style={item} aria-label='Favorites'>
        <HeartIcon />
        <span style={label}>Favorites</span>
      </a>
      <a href='/listings/new' style={{ ...item, ...center }}>
        <PlusIcon />
        <span style={{ ...label, color: '#fff' }}>Post</span>
      </a>
      <a href='/messages' style={item}>
        <MessageIcon />
        <span style={label}>Messages</span>
      </a>
      <a href='/settings' style={item} aria-label='Settings'>
        <SettingsIcon />
        <span style={label}>Settings</span>
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
function FeedIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M4 19h16' /><path d='M4 12h16' /><path d='M4 5h16' /></svg></IconWrap>;
}
function HeartIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 21s-6.5-4.35-9-8.25C1.2 9.9 2.2 6.5 5.25 5.35c2.14-.8 4.2-.05 5.5 1.55 1.3-1.6 3.36-2.35 5.5-1.55C19.3 6.5 20.3 9.9 18.5 12.75 16 16.65 12 21 12 21z' /></svg></IconWrap>;
}
function SettingsIcon() {
  return <IconWrap><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'><path d='M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7z'/><path d='M19.4 15a1.7 1.7 0 0 0 .34 1.87l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.06a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.87.34l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.94a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1A1.7 1.7 0 0 0 4.36 6.3l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.94a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.87-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 9c0 .38.14.74.4 1a1.7 1.7 0 0 0 1.1.4H21a2 2 0 1 1 0 4h-.06a1.7 1.7 0 0 0-1.1.4 1.7 1.7 0 0 0-.44 1.2z'/></svg></IconWrap>;
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
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
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
