'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function DashboardPage() {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name,role,phone,avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      setProfile(data || { full_name: user.email, role: 'buyer' });
    }
    load();
  }, []);

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' }}>
      <h1>Dashboard</h1>
      <p>Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}.</p>

      <section style={card}>
        <h3 style={{ marginTop: 0 }}>Your account</h3>
        <p style={{ margin: '6px 0' }}>Role: {profile?.role || '—'}</p>
        <p style={{ margin: '6px 0' }}>Phone: {profile?.phone || '—'}</p>
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <a href='/profile' style={btn}>Edit Profile</a>
        <a href='/listings' style={btn}>My Listings</a>
        <a href='/listings/new' style={btnPrimary}>Sell My Business</a>
        <a href='/messages' style={btn}>Messages</a>
      </div>
    </main>
  );
}

const card = { maxWidth: 640, background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const btn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const btnPrimary = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
