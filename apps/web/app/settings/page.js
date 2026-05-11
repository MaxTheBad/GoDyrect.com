'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

const roleOptions = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'broker', label: 'Broker' },
  { value: 'not_sure', label: 'Not sure yet' },
];

export default function SettingsPage() {
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('not_sure');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || '';
      setUserId(uid);
      if (!uid) return;
      const { data } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
      setRole(data?.role || 'not_sure');
    }
    load();
  }, []);

  async function saveRole(nextRole) {
    if (!supabase || !userId) return setMsg('Please sign in first.');
    const { error } = await supabase.from('profiles').upsert({ id: userId, role: nextRole });
    if (error) return setMsg(error.message);
    setRole(nextRole);
    setMsg(nextRole === 'not_sure' ? 'Onboarding reset.' : 'Role saved.');
  }

  async function signOut() {
    if (!supabase) return setMsg('Supabase env vars are missing.');
    const { error } = await supabase.auth.signOut();
    if (error) return setMsg(error.message);
    window.location.href = '/login';
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={hero}>
          <p style={eyebrow}>Onboarding controls</p>
          <h1 style={{ margin: '0 0 8px', color: '#fff' }}>Settings</h1>
          <p style={{ opacity: 0.85, color: 'rgba(255,255,255,0.75)', margin: 0 }}>Manage your account and onboarding preferences from here.</p>
        </div>

        <section style={section}>
          <h3 style={{ marginTop: 0, color: '#fff' }}>Onboarding</h3>
          <p style={muted}>Pick the path that matches what you’re here to do. You can change it anytime or reset it back to “not sure yet.”</p>

          <div style={roleGrid}>
            {roleOptions.map((opt) => (
              opt.value === 'buyer' || opt.value === 'seller' ? (
                <a
                  key={opt.value}
                  href={`/onboarding/${opt.value}`}
                  style={{ ...roleButton(role === opt.value), textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  {opt.label}
                </a>
              ) : (
                <button
                  key={opt.value}
                  type='button'
                  style={roleButton(role === opt.value)}
                  onClick={() => saveRole(opt.value)}
                >
                  {opt.label}
                </button>
              )
            ))}
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            <select style={input} value={role} onChange={(e) => saveRole(e.target.value)}>
              {roleOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>

            <button type='button' style={btnReset} onClick={() => saveRole('not_sure')}>Reset onboarding to not sure yet</button>
          </div>

          <div style={onboardingCopy(role)}>
            {role === 'seller' ? (
              <>
                <strong>Seller path</strong>
                <p style={copyText}>Complete your business details, post a listing, then share your business profile so buyers can follow and message you.</p>
              </>
            ) : role === 'buyer' ? (
              <>
                <strong>Buyer path</strong>
                <p style={copyText}>Follow businesses you like, save listings, and use Explore to find opportunities in your area.</p>
              </>
            ) : role === 'broker' ? (
              <>
                <strong>Broker path</strong>
                <p style={copyText}>Build out your profile, follow deal flow, and use business pages to manage multiple listings in one place.</p>
              </>
            ) : (
              <>
                <strong>Not sure yet</strong>
                <p style={copyText}>You’ll see a mixed path with both buyer and seller actions until you choose a direction.</p>
              </>
            )}
          </div>
        </section>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <a href='/profile' style={btn}>Profile Settings</a>
          <a href='/businesses' style={btn}>My Businesses</a>
          <a href='/legal/privacy' style={btn}>Privacy Policy</a>
          <button type='button' onClick={signOut} style={btnReset}>Sign out</button>
        </div>

        {msg ? <p style={{ color: '#cdd9ff' }}>{msg}</p> : null}
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 760, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 24, padding: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' };
const section = { marginTop: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(42,60,120,0.8)', borderRadius: 16, padding: 14 };
const muted = { color: 'rgba(255,255,255,0.75)', lineHeight: 1.5 };
const input = { borderRadius: 10, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '11px 12px' };
const btn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const btnPrimary = { border: '1px solid #2a3c78', borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const btnReset = { border: '1px solid rgba(255,92,92,0.55)', borderRadius: 10, background: 'rgba(255,92,92,0.14)', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const copyText = { margin: '8px 0 0', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 };
const onboardingCopy = (role) => ({ marginTop: 12, borderRadius: 14, padding: 14, background: role === 'seller' ? 'rgba(18,77,47,0.2)' : role === 'buyer' ? 'rgba(30,58,138,0.2)' : role === 'broker' ? 'rgba(91,75,22,0.2)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' });
const hero = { marginBottom: 14 };
const eyebrow = { margin: '0 0 10px', color: '#8fb7ff', letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: 12, fontWeight: 700 };
const roleGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 12 };
const roleButton = (active) => ({
  borderRadius: 14,
  border: active ? '1px solid rgba(143,183,255,0.85)' : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(46,125,255,0.25)' : 'rgba(255,255,255,0.04)',
  color: '#fff',
  padding: '12px 14px',
  cursor: 'pointer',
  fontWeight: 700,
});
