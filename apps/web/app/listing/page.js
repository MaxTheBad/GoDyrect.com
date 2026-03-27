'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function ListingDetailPage() {
  const [id, setId] = useState('');
  const [listing, setListing] = useState(null);
  const [media, setMedia] = useState([]);
  const [seller, setSeller] = useState(null);
  const [viewerId, setViewerId] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = new URLSearchParams(window.location.search).get('id') || '';
    setId(value);
  }, []);

  useEffect(() => {
    async function load() {
      if (!supabase || !id) return;

      const { data: auth } = await supabase.auth.getUser();
      setViewerId(auth?.user?.id || '');

      const { data: l, error: lErr } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .single();

      if (lErr) return setMsg(lErr.message);
      setListing(l);

      const [{ data: m, error: mErr }, { data: s }] = await Promise.all([
        supabase
          .from('listing_media')
          .select('id,media_type,url,thumbnail_url,sort_order')
          .eq('listing_id', id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('profiles')
          .select('id,full_name,handle,role,avatar_url')
          .eq('id', l.seller_id)
          .maybeSingle(),
      ]);

      if (mErr) return setMsg(mErr.message);
      setMedia(m || []);
      setSeller(s || null);
    }

    load();
  }, [id]);

  if (!id) {
    return <main style={wrap}><div style={card}><p>Missing listing id.</p><a href='/' style={{ color: '#8fb7ff' }}>Back home</a></div></main>;
  }

  if (!listing) {
    return <main style={wrap}><div style={card}><p>Loading listing...</p>{msg ? <p>{msg}</p> : null}</div></main>;
  }

  const isOwner = viewerId && viewerId === listing.seller_id;

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>{listing.title}</h1>
        <p style={{ opacity: 0.85 }}>{listing.category} · {listing.business_age_years ?? 0} years · {[listing.city, listing.state, listing.country].filter(Boolean).join(', ')}</p>
        <h2 style={{ marginTop: 8 }}>${Number(listing.asking_price || 0).toLocaleString()}</h2>

        <section style={section}>
          <h3 style={{ marginTop: 0 }}>Listed by</h3>
          <a href={`/profile/view?id=${listing.seller_id}`} style={sellerWrap}>
            {seller?.avatar_url ? <img src={seller.avatar_url} alt='Seller avatar' style={avatar} /> : <div style={avatarFallback}>{initial(seller?.full_name)}</div>}
            <div>
              <strong>{seller?.full_name || 'Seller'}</strong>
              <div style={{ opacity: 0.8, fontSize: 13 }}>
                {[listing.lister_role || 'Authorized Representative', seller?.role].filter(Boolean).join(' · ')}
              </div>
            </div>
          </a>
        </section>

        <section style={section}>
          <h3 style={{ marginTop: 0 }}>Description</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{listing.description || 'No description added yet.'}</p>
        </section>

        <section style={section}>
          <h3 style={{ marginTop: 0 }}>Photos & Videos</h3>
          {media.length === 0 ? <p>No media uploaded yet.</p> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {media.map((m) => (
              <div key={m.id} style={mediaCard}>
                {m.media_type === 'video' ? (
                  <video controls style={mediaEl} src={m.url} />
                ) : (
                  <img alt='Listing media' style={mediaEl} src={m.url} />
                )}
              </div>
            ))}
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {isOwner ? (
            <a href={`/listings/edit?id=${listing.id}`} style={btn}>Edit Listing</a>
          ) : (
            <a href={`/messages?seller=${listing.seller_id}&listing=${listing.id}`} style={btn}>Message Seller</a>
          )}
          <a href='/' style={ghostBtn}>Back home</a>
        </div>
      </div>
    </main>
  );
}

function initial(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 1000, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const section = { marginTop: 14, background: '#0e1738', border: '1px solid #304178', borderRadius: 10, padding: 12 };
const sellerWrap = { display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' };
const avatar = { width: 40, height: 40, borderRadius: 999, objectFit: 'cover', border: '1px solid #3a4f8f' };
const avatarFallback = { width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#243569', border: '1px solid #3a4f8f' };
const mediaCard = { border: '1px solid #304178', borderRadius: 10, overflow: 'hidden', background: '#0b1431' };
const mediaEl = { width: '100%', height: 170, objectFit: 'cover', display: 'block' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
