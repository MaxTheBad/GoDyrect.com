'use client';

export default function ConfirmedPage() {
  return (
    <main style={wrap}>
      <div style={card}>
        <a href='/' style={brand} aria-label='GoDyrect Home'>
          <img src='/logo.png' alt='GoDyrect' style={{ width: 140, height: 40, objectFit: 'contain' }} />
        </a>
        <p style={eyebrow}>Confirmed</p>
        <h1 style={title}>Your email is confirmed</h1>
        <p style={copy}>Your GoDyrect account is ready. You can sign in now and continue onboarding.</p>
        <div style={actions}>
          <a href='/login' style={primary}>Log in</a>
          <a href='/dashboard' style={secondary}>Go to dashboard</a>
        </div>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'radial-gradient(circle at 20% 20%, #16275f 0%, #0b1020 55%)', color: '#fff', padding: 16 };
const card = { width: 'min(560px, 100%)', display: 'grid', gap: 12, background: '#121b3f', border: '1px solid #2a3c78', padding: 24, borderRadius: 18 };
const brand = { display: 'inline-flex', alignItems: 'center', textDecoration: 'none' };
const eyebrow = { margin: 0, color: '#8fb7ff', letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: 12, fontWeight: 700 };
const title = { margin: 0, color: '#fff', fontSize: 'clamp(2rem, 4vw, 3rem)', lineHeight: 1.05 };
const copy = { margin: 0, color: 'rgba(255,255,255,0.8)', lineHeight: 1.5 };
const actions = { display: 'flex', gap: 10, flexWrap: 'wrap' };
const primary = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '12px 14px', textDecoration: 'none', fontWeight: 700 };
const secondary = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: '1px solid #304178', background: '#0e1738', color: '#fff', padding: '12px 14px', textDecoration: 'none', fontWeight: 700 };
