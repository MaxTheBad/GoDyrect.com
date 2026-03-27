'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthNav() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (mounted) {
        setUser(data?.user ?? null);
        setLoading(false);
      }
    }

    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);

    loadUser();

    if (!supabase) return () => {};
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      window.removeEventListener('resize', checkMobile);
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  if (loading) return null;

  const loggedOutLinks = (
    <>
      <a href='/login' style={ghostBtn}>Sign in</a>
      <a href='/signup' style={ghostBtn}>Sign up</a>
      <a href='/signup?intent=sell' style={primaryBtn}>Sell</a>
    </>
  );

  const loggedInLinks = (
    <>
      <a href='/dashboard' style={ghostBtn}>Dashboard</a>
      <a href='/profile' style={ghostBtn}>Profile</a>
      <a href='/listings/new' style={primaryBtn}>Sell</a>
      <a href='/messages' style={ghostBtn}>Messages</a>
      <button style={ghostBtn} onClick={signOut}>Sign out</button>
    </>
  );

  if (isMobile) {
    return (
      <div style={{ position: 'relative' }}>
        <button style={ghostBtn} onClick={() => setMenuOpen((v) => !v)} aria-label='Menu'>☰</button>
        {menuOpen ? <div style={mobileMenu}>{user ? loggedInLinks : loggedOutLinks}</div> : null}
      </div>
    );
  }

  return <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{user ? loggedInLinks : loggedOutLinks}</nav>;
}

const mobileMenu = {
  position: 'absolute',
  right: 0,
  top: 44,
  background: '#ffffff',
  border: '1px solid #e5e7eb',
  borderRadius: 14,
  padding: 8,
  display: 'grid',
  gap: 8,
  minWidth: 190,
  zIndex: 20,
  boxShadow: '0 10px 30px rgba(17,24,39,0.12)',
};

const primaryBtn = {
  border: 0,
  borderRadius: 999,
  background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 45%, #8134af 75%, #515bd4 100%)',
  color: '#fff',
  padding: '9px 14px',
  cursor: 'pointer',
  textDecoration: 'none',
  fontWeight: 600,
};

const ghostBtn = {
  border: '1px solid #e5e7eb',
  borderRadius: 999,
  background: '#fff',
  color: '#111827',
  padding: '9px 14px',
  cursor: 'pointer',
  textDecoration: 'none',
  fontWeight: 600,
};
