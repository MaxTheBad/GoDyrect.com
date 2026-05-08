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
    <main style={wrap}>
      <h1 style={{ marginTop: 0 }}>Dashboard</h1>
      <p style={{ color: 'rgba(255,255,255,0.78)' }}>Welcome back{profile?.full_name ? `, ${profile.full_name}` : ''}.</p>

      <section style={card}>
        <h3 style={{ marginTop: 0, color: '#fff' }}>Your account</h3>
        <p style={{ margin: '6px 0', color: 'rgba(255,255,255,0.84)' }}>Role: {profile?.role || '—'}</p>
        <p style={{ margin: '6px 0', color: 'rgba(255,255,255,0.84)' }}>Phone: {profile?.phone || '—'}</p>
      </section>

      <section style={card}>
        <h3 style={{ marginTop: 0, color: '#fff' }}>Your onboarding</h3>
        {profile?.role === 'seller' ? (
          <OnboardingList title='Seller path' items={['Finish business details', 'Create your first listing', 'Share your business profile']} />
        ) : profile?.role === 'buyer' ? (
          <OnboardingList title='Buyer path' items={['Follow businesses you like', 'Save listings', 'Browse Explore for more deals']} />
        ) : profile?.role === 'broker' ? (
          <OnboardingList title='Broker path' items={['Complete your profile', 'Set up your business pages', 'Manage listings and messages']} />
        ) : (
          <OnboardingList title='Choose a path' items={['Pick buyer or seller in Settings', 'You can reset it anytime', 'Explore the marketplace meanwhile']} />
        )}
      </section>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <a href='/profile' style={btn}>Edit Profile</a>
        <a href='/listings' style={btn}>My Listings</a>
        <a href='/businesses' style={btn}>My Businesses</a>
        <a href='/listings/new' style={btnPrimary}>Sell My Business</a>
        <a href='/messages' style={btn}>Messages</a>
        <a href='/settings' style={btn}>Settings</a>
      </div>
    </main>
  );
}

function OnboardingList({ title, items }) {
  return (
    <div>
      <strong style={{ color: '#fff' }}>{title}</strong>
      <ul style={{ margin: '8px 0 0 18px', color: 'rgba(255,255,255,0.82)', lineHeight: 1.7 }}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 760, background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 24, padding: 18, marginTop: 14 };
const btn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const btnPrimary = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
