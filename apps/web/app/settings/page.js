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

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0, color: '#fff' }}>Settings</h1>
        <p style={{ opacity: 0.85, color: 'rgba(255,255,255,0.75)' }}>Manage your account and onboarding preferences.</p>

        <section style={section}>
          <h3 style={{ marginTop: 0, color: '#fff' }}>Onboarding</h3>
          <p style={muted}>Pick the path that matches what you’re here to do. You can change it anytime or reset it back to “not sure yet.”</p>

          <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <select style={input} value={role} onChange={(e) => saveRole(e.target.value)}>
              {roleOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>

            <button type='button' style={btnPrimary} onClick={() => saveRole('not_sure')}>Reset onboarding</button>
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
const copyText = { margin: '8px 0 0', color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 };
const onboardingCopy = (role) => ({ marginTop: 12, borderRadius: 14, padding: 14, background: role === 'seller' ? 'rgba(18,77,47,0.2)' : role === 'buyer' ? 'rgba(30,58,138,0.2)' : role === 'broker' ? 'rgba(91,75,22,0.2)' : 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' });
