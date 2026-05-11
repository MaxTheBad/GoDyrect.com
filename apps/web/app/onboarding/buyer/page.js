'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const interestOptions = [
  'Restaurants',
  'Retail',
  'Ecommerce',
  'Services',
  'Manufacturing',
  'Real Estate',
  'Franchises',
  'Startups',
];

export default function BuyerOnboardingPage() {
  const [userId, setUserId] = useState('');
  const [fullName, setFullName] = useState('');
  const [interests, setInterests] = useState([]);
  const [buyerNotes, setBuyerNotes] = useState('');
  const [location, setLocation] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return;
      setUserId(user.id);
      const { data } = await supabase
        .from('profiles')
        .select('full_name,interests,buyer_notes')
        .eq('id', user.id)
        .maybeSingle();
      setFullName(data?.full_name || user.email || '');
      setInterests(Array.isArray(data?.interests) ? data.interests : []);
      setBuyerNotes(data?.buyer_notes || '');
    }
    load();
  }, []);

  function toggleInterest(item) {
    setInterests((curr) => (
      curr.includes(item) ? curr.filter((v) => v !== item) : [...curr, item]
    ));
  }

  async function save(e) {
    e.preventDefault();
    if (!supabase || !userId) return setMsg('Please sign in first.');
    setSaving(true);
    setMsg('');

    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: fullName,
      role: 'buyer',
      interests,
      buyer_notes: [location && `Looking in: ${location}`, buyerNotes].filter(Boolean).join('\n'),
    });

    setSaving(false);
    if (error) return setMsg(error.message);
    setMsg('Buyer onboarding saved.');
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <p style={eyebrow}>Onboarding</p>
        <h1 style={title}>What are you interested in?</h1>
        <p style={sub}>
          Tell us what kinds of businesses you want to see so we can tailor your feed and Explore results.
        </p>

        <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
          <label style={label}>Name</label>
          <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} />

          <label style={label}>What are you looking for?</label>
          <div style={grid}>
            {interestOptions.map((item) => (
              <button
                key={item}
                type='button'
                onClick={() => toggleInterest(item)}
                style={chip(interests.includes(item))}
              >
                {item}
              </button>
            ))}
          </div>

          <label style={label}>Location preference</label>
          <input
            style={input}
            placeholder='City, state, or ZIP'
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />

          <label style={label}>Notes</label>
          <textarea
            style={{ ...input, minHeight: 110, resize: 'vertical' }}
            placeholder='Budget, deal size, industries, or anything else we should know'
            value={buyerNotes}
            onChange={(e) => setBuyerNotes(e.target.value)}
          />

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type='submit' disabled={saving} style={btnPrimary}>
              {saving ? 'Saving...' : 'Save buyer setup'}
            </button>
            <a href='/feed' style={btnGhost}>Go to feed</a>
            <a href='/explore' style={btnGhost}>Browse explore</a>
          </div>
        </form>

        {msg ? <p style={{ margin: 0, color: '#cdd9ff' }}>{msg}</p> : null}
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 900, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 24, padding: 20, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' };
const eyebrow = { margin: '0 0 10px', color: '#8fb7ff', letterSpacing: '0.18em', textTransform: 'uppercase', fontSize: 12, fontWeight: 700 };
const title = { margin: '0 0 8px', color: '#fff', fontSize: 'clamp(2rem, 4vw, 3.2rem)', lineHeight: 1.05 };
const sub = { margin: 0, color: 'rgba(255,255,255,0.78)', lineHeight: 1.5, maxWidth: 760 };
const label = { fontSize: 13, opacity: 0.88 };
const input = { borderRadius: 12, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '12px 14px' };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 };
const chip = (active) => ({
  borderRadius: 999,
  padding: '12px 14px',
  border: active ? '1px solid rgba(143,183,255,0.85)' : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(46,125,255,0.25)' : 'rgba(255,255,255,0.04)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
});
const btnPrimary = { border: 0, borderRadius: 12, background: '#2e7dff', color: '#fff', padding: '12px 14px', cursor: 'pointer', textDecoration: 'none' };
const btnGhost = { border: '1px solid #304178', borderRadius: 12, background: '#0e1738', color: '#fff', padding: '12px 14px', textDecoration: 'none' };
