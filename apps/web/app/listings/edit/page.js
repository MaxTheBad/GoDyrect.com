'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function EditListingPage() {
  const [id, setId] = useState('');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = new URLSearchParams(window.location.search).get('id') || '';
    setId(value);
  }, []);

  useEffect(() => {
    async function load() {
      if (!supabase || !id) return;
      const { data, error } = await supabase
        .from('listings')
        .select('id,title,description,category,business_age_years,asking_price,annual_revenue,annual_profit,city,state,country,county,is_active,is_sold,keywords')
        .eq('id', id)
        .single();
      if (error) return setMsg(error.message);
      setForm({ ...data, keywords: (data.keywords || []).join(', ') });
    }
    load();
  }, [id]);

  function update(key, value) {
    setForm((s) => ({ ...s, [key]: value }));
  }

  async function save(e) {
    e.preventDefault();
    if (!supabase || !form) return;

    const payload = {
      title: form.title,
      description: form.description,
      category: form.category,
      business_age_years: Number(form.business_age_years || 0),
      asking_price: Number(form.asking_price || 0),
      annual_revenue: form.annual_revenue ? Number(form.annual_revenue) : null,
      annual_profit: form.annual_profit ? Number(form.annual_profit) : null,
      city: form.city,
      state: form.state,
      country: form.country,
      county: form.county,
      is_active: !!form.is_active,
      is_sold: !!form.is_sold,
      keywords: (form.keywords || '').split(',').map((x) => x.trim()).filter(Boolean),
    };

    const { error } = await supabase.from('listings').update(payload).eq('id', id);
    setMsg(error ? error.message : 'Listing updated.');
  }

  if (!id) {
    return <main style={wrap}><div style={card}><p>Missing listing id.</p><a href='/listings' style={{ color: '#8fb7ff' }}>Back to Listings</a></div></main>;
  }

  if (!form) {
    return <main style={wrap}><div style={card}><p>Loading listing...</p>{msg ? <p>{msg}</p> : null}</div></main>;
  }

  return (
    <main style={wrap}>
      <form onSubmit={save} style={card}>
        <h1>Edit Listing</h1>
        <input style={input} value={form.title || ''} onChange={(e) => update('title', e.target.value)} placeholder='Title' required />
        <textarea style={input} rows={4} value={form.description || ''} onChange={(e) => update('description', e.target.value)} placeholder='Description' />
        <select style={input} value={form.category || 'established'} onChange={(e) => update('category', e.target.value)}>
          <option value='established'>Established Businesses</option>
          <option value='asset_sale'>Asset Sales</option>
          <option value='real_estate'>Real Estate</option>
          <option value='startup'>Start-up Businesses</option>
        </select>
        <input style={input} value={form.business_age_years ?? 0} onChange={(e) => update('business_age_years', e.target.value)} placeholder='Business age' />
        <input style={input} value={form.asking_price ?? ''} onChange={(e) => update('asking_price', e.target.value)} placeholder='Asking price' />
        <input style={input} value={form.annual_revenue ?? ''} onChange={(e) => update('annual_revenue', e.target.value)} placeholder='Annual revenue' />
        <input style={input} value={form.annual_profit ?? ''} onChange={(e) => update('annual_profit', e.target.value)} placeholder='Annual profit' />
        <input style={input} value={form.city || ''} onChange={(e) => update('city', e.target.value)} placeholder='City' />
        <input style={input} value={form.state || ''} onChange={(e) => update('state', e.target.value)} placeholder='State' />
        <input style={input} value={form.country || ''} onChange={(e) => update('country', e.target.value)} placeholder='Country' />
        <input style={input} value={form.county || ''} onChange={(e) => update('county', e.target.value)} placeholder='County' />
        <input style={input} value={form.keywords || ''} onChange={(e) => update('keywords', e.target.value)} placeholder='Keywords (comma separated)' />
        <label style={label}><input type='checkbox' checked={!!form.is_active} onChange={(e) => update('is_active', e.target.checked)} /> Active</label>
        <label style={label}><input type='checkbox' checked={!!form.is_sold} onChange={(e) => update('is_sold', e.target.checked)} /> Mark as sold</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={btn} type='submit'>Save Changes</button>
          <a href='/listings' style={ghostBtn}>Back to Listings</a>
        </div>
        {msg ? <p>{msg}</p> : null}
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 760, margin: '0 auto', display: 'grid', gap: 10, background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const label = { display: 'flex', alignItems: 'center', gap: 8 };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
