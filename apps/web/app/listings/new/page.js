'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

const states = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia',
  'Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts',
  'Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico',
  'New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina',
  'South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'
];

const countries = [
  'United States','Canada','United Kingdom','Australia','Germany','France','Spain','Italy','Netherlands','Sweden',
  'Norway','Denmark','Switzerland','India','Mexico','Brazil','United Arab Emirates','Singapore','Japan','South Africa'
];

const ages = Array.from({ length: 301 }, (_, i) => i);

export default function NewListingPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'established',
    business_age_years: '0',
    asking_price: '',
    annual_revenue: '',
    annual_profit: '',
    city: '',
    state: 'Florida',
    country: 'United States',
    county: '',
    keywords: '',
  });
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    async function checkAuth() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      setIsAuthed(!!data?.user);
    }
    checkAuth();
  }, []);

  function update(key, value) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    if (!form.title.trim()) return setErrors((p)=>({ ...p, title: 'Title is required.' }));
    if (!form.asking_price || Number(form.asking_price) <= 0) return setErrors((p)=>({ ...p, asking_price: 'Enter a valid asking price.' }));
    if (!supabase) return setMsg('Supabase env vars missing.');

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return setMsg('Please log in first.');

    await supabase.from('profiles').upsert({
      id: user.id,
      full_name: user.user_metadata?.full_name || null,
      phone: user.user_metadata?.phone || null,
      role: user.user_metadata?.role || 'seller',
    });

    const { data: listing, error } = await supabase
      .from('listings')
      .insert({
        seller_id: user.id,
        title: form.title,
        description: form.description,
        category: form.category,
        business_age_years: Number(form.business_age_years),
        asking_price: Number(form.asking_price || 0),
        annual_revenue: form.annual_revenue ? Number(form.annual_revenue) : null,
        annual_profit: form.annual_profit ? Number(form.annual_profit) : null,
        city: form.city,
        state: form.state,
        country: form.country,
        county: form.county,
        keywords: form.keywords.split(',').map((k) => k.trim()).filter(Boolean),
      })
      .select('id')
      .single();

    if (error) return setMsg(error.message);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${listing.id}/${Date.now()}-${i}.${ext}`;
      const upload = await supabase.storage.from('listing-media').upload(path, file, { upsert: true });
      if (upload.error) return setMsg(upload.error.message);
      const { data: pub } = supabase.storage.from('listing-media').getPublicUrl(path);
      const mediaType = file.type.startsWith('video') ? 'video' : 'image';
      const mediaInsert = await supabase.from('listing_media').insert({
        listing_id: listing.id,
        media_type: mediaType,
        url: pub.publicUrl,
        sort_order: i,
      });
      if (mediaInsert.error) return setMsg(mediaInsert.error.message);
    }

    setMsg('Listing posted. Redirecting...');
    setTimeout(() => router.push('/listings'), 400);
  }

  const withError = (key) => ({ ...input, border: errors[key] ? '1px solid #ef5350' : input.border });

  if (!isAuthed) {
    return (
      <main style={wrap}>
        <div style={card}>
          <h1>Sell My Business</h1>
          <p>You need an account to post a business listing.</p>
          <a href='/signup' style={{ color: '#8fb7ff' }}>Create account</a>
          <a href='/login' style={{ color: '#8fb7ff' }}>Log in</a>
        </div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1>Post Business</h1>
        <input style={withError('title')} placeholder='Title' value={form.title} onChange={(e) => update('title', e.target.value)} required />
        {errors.title ? <small style={errText}>{errors.title}</small> : null}
        <textarea style={input} placeholder='Description' value={form.description} onChange={(e) => update('description', e.target.value)} rows={4} />
        <select style={input} value={form.category} onChange={(e) => update('category', e.target.value)}>
          <option value='established'>Established Businesses</option>
          <option value='asset_sale'>Asset Sales</option>
          <option value='real_estate'>Real Estate</option>
          <option value='startup'>Start-up Businesses</option>
        </select>

        <label style={label}>Business age (years)</label>
        <select style={input} value={form.business_age_years} onChange={(e) => update('business_age_years', e.target.value)}>
          {ages.map((age) => <option key={age} value={age}>{age}</option>)}
        </select>

        <input style={withError('asking_price')} placeholder='Asking price' value={form.asking_price} onChange={(e) => update('asking_price', e.target.value)} required />
        {errors.asking_price ? <small style={errText}>{errors.asking_price}</small> : null}
        <input style={input} placeholder='Annual revenue (optional)' value={form.annual_revenue} onChange={(e) => update('annual_revenue', e.target.value)} />
        <input style={input} placeholder='Annual profit (optional)' value={form.annual_profit} onChange={(e) => update('annual_profit', e.target.value)} />
        <input style={input} placeholder='City' value={form.city} onChange={(e) => update('city', e.target.value)} />

        <label style={label}>State</label>
        <select style={input} value={form.state} onChange={(e) => update('state', e.target.value)}>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <label style={label}>Country</label>
        <select style={input} value={form.country} onChange={(e) => update('country', e.target.value)}>
          {countries.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <input style={input} placeholder='County' value={form.county} onChange={(e) => update('county', e.target.value)} />
        <input style={input} placeholder='Keywords (comma separated)' value={form.keywords} onChange={(e) => update('keywords', e.target.value)} />
        <input style={input} type='file' multiple accept='image/*,video/*' onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button style={btn} type='submit'>Publish Listing</button>
        {msg ? <p>{msg}</p> : null}
        <a href='/' style={{ color: '#8fb7ff' }}>Back home</a>
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 680, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12 };
const label = { fontSize: 13, opacity: 0.85 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const errText = { color: '#ff8a80', fontSize: 12, marginTop: -4 };
