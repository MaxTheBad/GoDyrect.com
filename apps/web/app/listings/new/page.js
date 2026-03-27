'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

function yearsSince(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  const m = now.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < start.getDate())) years -= 1;
  return Math.max(0, years);
}

function completeness(business) {
  const fields = [
    !!business?.description,
    !!business?.category,
    !!business?.start_date,
    business?.annual_revenue != null,
    business?.annual_profit != null,
    business?.default_asking_price != null,
    !!business?.city,
    !!business?.state,
    !!business?.country,
    !!business?.county,
    Array.isArray(business?.keywords) && business.keywords.length > 0,
  ];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
}

export default function NewListingPage() {
  const router = useRouter();
  const [form, setForm] = useState({ business_id: '', title: '', lister_role: 'Owner', asking_price: '' });
  const [files, setFiles] = useState([]);
  const [msg, setMsg] = useState('');
  const [isAuthed, setIsAuthed] = useState(false);
  const [approvedBusinesses, setApprovedBusinesses] = useState([]);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [useDefaultAskingPrice, setUseDefaultAskingPrice] = useState(true);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    async function checkAuth() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      setIsAuthed(!!user);
      if (!user) return;

      const requestedBusiness = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('business') : '';

      const { data: memberships, error } = await supabase
        .from('business_memberships')
        .select('business_id,role,businesses(id,name,status,description,category,start_date,annual_revenue,annual_profit,default_asking_price,city,state,country,county,keywords)')
        .eq('user_id', user.id)
        .eq('status', 'approved');

      if (error) {
        if (error.message?.includes("public.business_memberships")) {
          setMsg('Business tables are not created yet in Supabase. Run latest supabase/schema.sql in SQL editor, then refresh.');
        } else {
          setMsg(error.message);
        }
        return;
      }

      const options = (memberships || [])
        .filter((m) => m.businesses?.status === 'approved')
        .map((m) => ({
          id: m.business_id,
          name: m.businesses?.name || 'Business',
          role: m.role || 'Authorized Representative',
          business: m.businesses,
        }));

      setApprovedBusinesses(options);

      if (options.length) {
        const picked = options.find((o) => o.id === requestedBusiness) || options[0];
        setForm((prev) => ({
          ...prev,
          business_id: picked.id,
          lister_role: picked.role,
          asking_price: picked.business?.default_asking_price ? String(picked.business.default_asking_price) : prev.asking_price,
        }));
        setSelectedBusiness(picked.business || null);
      }
    }
    checkAuth();
  }, []);

  function update(key, value) {
    setForm((s) => {
      if (key === 'business_id') {
        const selected = approvedBusinesses.find((b) => b.id === value);
        setSelectedBusiness(selected?.business || null);
        return {
          ...s,
          business_id: value,
          lister_role: selected?.role || s.lister_role,
          asking_price: useDefaultAskingPrice && selected?.business?.default_asking_price
            ? String(selected.business.default_asking_price)
            : s.asking_price,
        };
      }
      return { ...s, [key]: value };
    });
  }

  const computedAge = useMemo(() => yearsSince(selectedBusiness?.start_date), [selectedBusiness]);
  const completenessPct = useMemo(() => completeness(selectedBusiness || {}), [selectedBusiness]);

  useEffect(() => {
    if (useDefaultAskingPrice && selectedBusiness?.default_asking_price) {
      setForm((prev) => ({ ...prev, asking_price: String(selectedBusiness.default_asking_price) }));
    }
  }, [useDefaultAskingPrice, selectedBusiness]);

  async function submit(e) {
    e.preventDefault();
    setErrors({});
    if (!form.business_id) return setErrors((p) => ({ ...p, business_id: 'Choose an approved business first.' }));
    if (!form.title.trim()) return setErrors((p) => ({ ...p, title: 'Title is required.' }));
    if (!form.asking_price || Number(form.asking_price) <= 0) return setErrors((p) => ({ ...p, asking_price: 'Enter a valid asking price.' }));
    if (!supabase) return setMsg('Supabase env vars missing.');

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return setMsg('Please log in first.');

    const { data: membership, error: membershipErr } = await supabase
      .from('business_memberships')
      .select('role,status,businesses(id,name,description,category,start_date,annual_revenue,annual_profit,city,state,country,county,keywords)')
      .eq('user_id', user.id)
      .eq('business_id', form.business_id)
      .eq('status', 'approved')
      .maybeSingle();

    if (membershipErr) return setMsg(membershipErr.message);
    if (!membership) return setMsg('You are not approved to post for this business.');

    const business = membership.businesses || {};

    const { count: existingListingsCount } = await supabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', form.business_id);

    const isFirstPostForBusiness = !existingListingsCount;
    if (isFirstPostForBusiness) {
      const missing = [];
      if (!business.description) missing.push('description');
      if (!business.category) missing.push('category');
      if (!business.start_date) missing.push('start date');
      if (business.annual_revenue == null) missing.push('annual revenue');
      if (business.annual_profit == null) missing.push('annual profit');
      if (!business.city || !business.state || !business.country) missing.push('location (city/state/country)');
      if (!Array.isArray(business.keywords) || business.keywords.length === 0) missing.push('keywords');

      if (missing.length) {
        return setMsg(`Before first post, complete business profile fields in My Businesses: ${missing.join(', ')}.`);
      }
    }

    const { data: listing, error } = await supabase
      .from('listings')
      .insert({
        seller_id: user.id,
        business_id: form.business_id,
        title: form.title,
        description: business.description || null,
        category: business.category || 'established',
        lister_role: membership.role || form.lister_role,
        business_age_years: yearsSince(business.start_date),
        asking_price: Number(form.asking_price || 0),
        annual_revenue: business.annual_revenue ?? null,
        annual_profit: business.annual_profit ?? null,
        city: business.city || null,
        state: business.state || null,
        country: business.country || null,
        county: business.county || null,
        keywords: Array.isArray(business.keywords) ? business.keywords : [],
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
    setTimeout(() => router.push('/listings'), 450);
  }

  const withError = (key) => ({ ...input, border: errors[key] ? '1px solid #ef5350' : input.border });

  if (!isAuthed) {
    return (
      <main style={wrap}><div style={card}><h1>Sell My Business</h1><p>You need an account to post.</p><a href='/signup' style={{ color: '#8fb7ff' }}>Create account</a></div></main>
    );
  }

  if (isAuthed && approvedBusinesses.length === 0) {
    return (
      <main style={wrap}><div style={card}><h1>Post Business</h1><p>You need an approved business before posting.</p><a href='/businesses' style={{ color: '#8fb7ff' }}>Go to My Businesses</a>{msg ? <p>{msg}</p> : null}</div></main>
    );
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1>Post Business</h1>
        <p style={{ opacity: 0.82, marginTop: -4 }}>Business profile fields are pulled from My Businesses so you only fill them once.</p>

        <label style={label}>Business (approved)</label>
        <select style={withError('business_id')} value={form.business_id} onChange={(e) => update('business_id', e.target.value)} required>
          <option value=''>Select your business</option>
          {approvedBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        <input style={withError('title')} placeholder='Listing title / headline' value={form.title} onChange={(e) => update('title', e.target.value)} required />
        <label style={label}>Posting as role</label>
        <input style={input} value={form.lister_role} readOnly />

        <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type='checkbox' checked={useDefaultAskingPrice} onChange={(e) => setUseDefaultAskingPrice(e.target.checked)} />
          Use business default asking price
        </label>
        <input
          style={withError('asking_price')}
          placeholder='Asking price'
          value={form.asking_price}
          onChange={(e) => update('asking_price', e.target.value)}
          disabled={useDefaultAskingPrice && !!selectedBusiness?.default_asking_price}
          required
        />

        {selectedBusiness ? (
          <div style={infoBox}>
            <strong>Business details used in this post</strong>
            <div style={small}>Category: {selectedBusiness.category || '—'}</div>
            <div style={small}>Business age: {computedAge !== null ? `${computedAge} years (from start date)` : '—'}</div>
            <div style={small}>Revenue: {selectedBusiness.annual_revenue ?? '—'} · Profit: {selectedBusiness.annual_profit ?? '—'}</div>
            <div style={small}>Location: {[selectedBusiness.city, selectedBusiness.state, selectedBusiness.country].filter(Boolean).join(', ') || '—'}</div>
            <div style={small}>Profile completeness: {completenessPct}%</div>
          </div>
        ) : null}

        <input style={input} type='file' multiple accept='image/*,video/*' onChange={(e) => setFiles(Array.from(e.target.files || []))} />
        <button style={btn} type='submit'>Publish Listing</button>
        {msg ? <p>{msg}</p> : null}
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 700, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12 };
const label = { fontSize: 13, opacity: 0.85 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const infoBox = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 10, display: 'grid', gap: 6 };
const small = { fontSize: 13, opacity: 0.85 };
