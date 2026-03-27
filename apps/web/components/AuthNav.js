'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthNav() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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

    loadUser();

    if (!supabase) return () => {};
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription?.subscription?.unsubscribe();
    };
  }, []);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  if (loading) return null;

  if (!user) {
    return (
      <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href='/login' style={ghostBtn}>Log in</a>
        <a href='/signup' style={primaryBtn}>Sign up</a>
      </nav>
    );
  }

  return (
    <nav style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a href='/dashboard' style={ghostBtn}>Dashboard</a>
      <a href='/profile' style={ghostBtn}>Profile</a>
      <a href='/listings/new' style={ghostBtn}>Post Business</a>
      <a href='/messages' style={ghostBtn}>Messages</a>
      <button style={primaryBtn} onClick={signOut}>Sign out</button>
    </nav>
  );
}

const primaryBtn = {
  border: 0,
  borderRadius: 10,
  background: '#2e7dff',
  color: '#fff',
  padding: '10px 12px',
  cursor: 'pointer',
  textDecoration: 'none',
};

const ghostBtn = {
  border: '1px solid #304178',
  borderRadius: 10,
  background: '#0e1738',
  color: '#fff',
  padding: '10px 12px',
  cursor: 'pointer',
  textDecoration: 'none',
};
