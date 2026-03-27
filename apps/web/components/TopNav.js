'use client';

import AuthNav from './AuthNav';

export default function TopNav() {
  return (
    <header style={wrap}>
      <div style={inner}>
        <a href='/' style={brand}>
          <div style={brandIcon} />
          <strong style={{ fontSize: 20, color: '#fff' }}>GoDyrect</strong>
        </a>
        <AuthNav />
      </div>
    </header>
  );
}

const wrap = {
  position: 'sticky',
  top: 0,
  zIndex: 50,
  background: 'rgba(11,16,32,0.92)',
  backdropFilter: 'blur(6px)',
  borderBottom: '1px solid #1f2d5c',
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
const brandIcon = { width: 34, height: 34, borderRadius: 10, background: '#2e7dff' };
