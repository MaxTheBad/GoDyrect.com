'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function EditListingPage() {
  const [id, setId] = useState('');
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const [media, setMedia] = useState([]);
  const [newFiles, setNewFiles] = useState([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = new URLSearchParams(window.location.search).get('id') || '';
    setId(value);
  }, []);

  async function loadAll(listingId) {
    if (!supabase || !listingId) return;

    const [{ data, error }, { data: mediaRows, error: mediaErr }] = await Promise.all([
      supabase
        .from('listings')
        .select('id,title,description,category,lister_role,business_age_years,asking_price,annual_revenue,annual_profit,city,state,country,county,is_active,is_sold,keywords')
        .eq('id', listingId)
        .single(),
      supabase
        .from('listing_media')
        .select('id,media_type,url,thumbnail_url,sort_order')
        .eq('listing_id', listingId)
        .order('sort_order', { ascending: true }),
    ]);

    if (error) return setMsg(error.message);
    if (mediaErr) return setMsg(mediaErr.message);

    setForm({ ...data, keywords: (data.keywords || []).join(', ') });
    setMedia(mediaRows || []);
  }

  useEffect(() => {
    loadAll(id);
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
      lister_role: form.lister_role,
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

  async function addMedia() {
    if (!supabase || !id || newFiles.length === 0) return;
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return setMsg('Please log in again.');

    const startOrder = media.length;

    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = file.name.split('.').pop();
      const path = `${user.id}/${id}/${Date.now()}-${i}.${ext}`;
      const upload = await supabase.storage.from('listing-media').upload(path, file, { upsert: false });
      if (upload.error) return setMsg(upload.error.message);

      const { data: pub } = supabase.storage.from('listing-media').getPublicUrl(path);
      const mediaType = file.type.startsWith('video') ? 'video' : 'image';

      const { error } = await supabase.from('listing_media').insert({
        listing_id: id,
        media_type: mediaType,
        url: pub.publicUrl,
        sort_order: startOrder + i,
      });
      if (error) return setMsg(error.message);
    }

    setNewFiles([]);
    setMsg('Media added.');
    loadAll(id);
  }

  async function removeMedia(mediaId) {
    if (!supabase) return;
    const ok = window.confirm('Remove this media item?');
    if (!ok) return;
    const { error } = await supabase.from('listing_media').delete().eq('id', mediaId);
    if (error) return setMsg(error.message);
    setMedia((prev) => prev.filter((m) => m.id !== mediaId));
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
        <select style={input} value={form.lister_role || 'Owner'} onChange={(e) => update('lister_role', e.target.value)}>
          <option>Owner</option><option>CEO</option><option>Founder</option><option>Managing Partner</option><option>Broker</option><option>Manager</option><option>Authorized Representative</option>
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

        <section style={mediaSection}>
          <strong>Media</strong>
          <div style={mediaGrid}>
            {media.map((m) => (
              <div key={m.id} style={mediaItem}>
                {m.media_type === 'video' ? <video src={m.url} controls style={mediaEl} /> : <img src={m.thumbnail_url || m.url} alt='media' style={mediaEl} />}
                <button type='button' style={removeBtn} onClick={() => removeMedia(m.id)}>Remove</button>
              </div>
            ))}
            {media.length === 0 ? <p style={{ opacity: 0.8 }}>No media yet.</p> : null}
          </div>

          <input type='file' multiple accept='image/*,video/*' style={input} onChange={(e) => setNewFiles(Array.from(e.target.files || []))} />
          <button type='button' style={btn} onClick={addMedia}>Add Selected Media</button>
        </section>

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
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const mediaSection = { marginTop: 8, border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 10, display: 'grid', gap: 10 };
const mediaGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 };
const mediaItem = { border: '1px solid #304178', borderRadius: 8, overflow: 'hidden', background: '#0b1431', display: 'grid', gap: 6, padding: 6 };
const mediaEl = { width: '100%', height: 90, objectFit: 'cover', borderRadius: 6 };
const removeBtn = { border: '1px solid #7a3040', borderRadius: 6, background: '#3a1520', color: '#ffd7dd', padding: '5px 8px', cursor: 'pointer', fontSize: 12 };
