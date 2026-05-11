'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

const categoryOptions = [
  { value: 'established', label: 'Established business' },
  { value: 'asset_sale', label: 'Asset sale' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'startup', label: 'Startup' },
];

export default function SellerOnboardingPage() {
  const [userId, setUserId] = useState('');
  const [fullName, setFullName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('established');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [keywords, setKeywords] = useState('');
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
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      setFullName(data?.full_name || user.email || '');
    }
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!supabase || !userId) return setMsg('Please sign in first.');
    setSaving(true);
    setMsg('');

    const { data: business, error } = await supabase.from('businesses').insert({
      name,
      description,
      category,
      city,
      state,
      zip,
      country: 'United States',
      keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
      created_by: userId,
    }).select('id').single();

    if (error) {
      setSaving(false);
      return setMsg(error.message);
    }

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: userId,
      full_name: fullName,
      role: 'seller',
      seller_notes: `Business: ${name || ''}\nCategory: ${category}\nLocation: ${[city, state, zip].filter(Boolean).join(', ')}`,
    });

    setSaving(false);
    if (profileError) return setMsg(profileError.message);
    setMsg('Business saved. You can now create your first listing.');

    if (business?.id) {
      window.location.href = `/listings/new?business=${business.id}`;
    }
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <p style={eyebrow}>Onboarding</p>
        <h1 style={title}>Add your business</h1>
        <p style={sub}>
          Give us the basics now, then we’ll take you straight into your first listing when you’re ready.
        </p>

        <form onSubmit={save} style={{ display: 'grid', gap: 14 }}>
          <label style={label}>Name</label>
          <input style={input} value={fullName} onChange={(e) => setFullName(e.target.value)} />

          <label style={label}>Business name</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder='Tarpooning.com' required />

          <label style={label}>Description</label>
          <textarea
            style={{ ...input, minHeight: 110, resize: 'vertical' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='What does the business do?'
            required
          />

          <label style={label}>Category</label>
          <div style={grid}>
            {categoryOptions.map((opt) => (
              <button
                key={opt.value}
                type='button'
                onClick={() => setCategory(opt.value)}
                style={chip(category === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div style={twoCol}>
            <div>
              <label style={label}>City</label>
              <input style={input} value={city} onChange={(e) => setCity(e.target.value)} placeholder='Miami' />
            </div>
            <div>
              <label style={label}>State</label>
              <input style={input} value={state} onChange={(e) => setState(e.target.value)} placeholder='FL' />
            </div>
          </div>

          <div style={twoCol}>
            <div>
              <label style={label}>ZIP</label>
              <input style={input} value={zip} onChange={(e) => setZip(e.target.value)} placeholder='33101' />
            </div>
            <div>
              <label style={label}>Keywords</label>
              <input style={input} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder='tarping, logistics, wholesale' />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type='submit' disabled={saving} style={btnPrimary}>
              {saving ? 'Saving...' : 'Save business and continue'}
            </button>
            <a href='/businesses' style={btnGhost}>My businesses</a>
            <a href='/feed' style={btnGhost}>Go to feed</a>
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
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 };
const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 };
const chip = (active) => ({
  borderRadius: 14,
  padding: '12px 14px',
  border: active ? '1px solid rgba(143,183,255,0.85)' : '1px solid rgba(255,255,255,0.08)',
  background: active ? 'rgba(46,125,255,0.25)' : 'rgba(255,255,255,0.04)',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
});
const btnPrimary = { border: 0, borderRadius: 12, background: '#2e7dff', color: '#fff', padding: '12px 14px', cursor: 'pointer', textDecoration: 'none' };
const btnGhost = { border: '1px solid #304178', borderRadius: 12, background: '#0e1738', color: '#fff', padding: '12px 14px', textDecoration: 'none' };
