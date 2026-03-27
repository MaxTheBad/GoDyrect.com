'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function ListingDetailPage() {
  const [id, setId] = useState('');
  const [listing, setListing] = useState(null);
  const [media, setMedia] = useState([]);
  const [seller, setSeller] = useState(null);
  const [business, setBusiness] = useState(null);
  const [viewerId, setViewerId] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isFollowingSeller, setIsFollowingSeller] = useState(false);
  const [isFollowingBusiness, setIsFollowingBusiness] = useState(false);
  const [sellerFollowerCount, setSellerFollowerCount] = useState(0);
  const [businessFollowerCount, setBusinessFollowerCount] = useState(0);
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
      const uid = auth?.user?.id || '';
      setViewerId(uid);

      if (uid) {
        const { data: favoriteRow } = await supabase
          .from('favorites')
          .select('listing_id')
          .eq('user_id', uid)
          .eq('listing_id', id)
          .maybeSingle();
        setIsFavorite(Boolean(favoriteRow));
      }

      const { data: l, error: lErr } = await supabase
        .from('listings')
        .select('*')
        .eq('id', id)
        .single();

      if (lErr) return setMsg(lErr.message);
      setListing(l);

      const { data: sellerFollowers } = await supabase
        .from('user_follows')
        .select('follower_user_id')
        .eq('followed_user_id', l.seller_id);
      setSellerFollowerCount((sellerFollowers || []).length);

      if (uid && uid !== l.seller_id) {
        const { data: sellerFollow } = await supabase
          .from('user_follows')
          .select('followed_user_id')
          .eq('follower_user_id', uid)
          .eq('followed_user_id', l.seller_id)
          .maybeSingle();
        setIsFollowingSeller(Boolean(sellerFollow));
      }

      if (l.business_id) {
        const { data: businessFollowers } = await supabase
          .from('business_follows')
          .select('follower_user_id')
          .eq('business_id', l.business_id);
        setBusinessFollowerCount((businessFollowers || []).length);
      }

      if (uid && l.business_id) {
        const { data: businessFollow } = await supabase
          .from('business_follows')
          .select('business_id')
          .eq('follower_user_id', uid)
          .eq('business_id', l.business_id)
          .maybeSingle();
        setIsFollowingBusiness(Boolean(businessFollow));
      }

      const [{ data: m, error: mErr }, { data: s }, { data: b }] = await Promise.all([
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
        l.business_id
          ? supabase.from('businesses').select('id,name').eq('id', l.business_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (mErr) return setMsg(mErr.message);
      setMedia(m || []);
      setSeller(s || null);
      setBusiness(b || null);
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

  async function toggleFavorite() {
    if (!supabase) return;
    if (!viewerId) {
      setMsg('Please sign in to save favorites.');
      return;
    }

    if (isFavorite) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', viewerId).eq('listing_id', listing.id);
      if (error) return setMsg(error.message);
      setIsFavorite(false);
      return;
    }

    const { error } = await supabase.from('favorites').insert({ user_id: viewerId, listing_id: listing.id });
    if (error) return setMsg(error.message);
    setIsFavorite(true);
  }

  async function toggleFollowSeller() {
    if (!supabase || !viewerId || !listing || viewerId === listing.seller_id) return;
    if (isFollowingSeller) {
      const { error } = await supabase.from('user_follows').delete().eq('follower_user_id', viewerId).eq('followed_user_id', listing.seller_id);
      if (error) return setMsg(error.message);
      setIsFollowingSeller(false);
      setSellerFollowerCount((c) => Math.max(c - 1, 0));
      return;
    }

    const { error } = await supabase.from('user_follows').insert({ follower_user_id: viewerId, followed_user_id: listing.seller_id });
    if (error) return setMsg(error.message);
    setIsFollowingSeller(true);
    setSellerFollowerCount((c) => c + 1);
  }

  async function toggleFollowBusiness() {
    if (!supabase || !viewerId || !listing?.business_id) return;
    if (isFollowingBusiness) {
      const { error } = await supabase.from('business_follows').delete().eq('follower_user_id', viewerId).eq('business_id', listing.business_id);
      if (error) return setMsg(error.message);
      setIsFollowingBusiness(false);
      setBusinessFollowerCount((c) => Math.max(c - 1, 0));
      return;
    }

    const { error } = await supabase.from('business_follows').insert({ follower_user_id: viewerId, business_id: listing.business_id });
    if (error) return setMsg(error.message);
    setIsFollowingBusiness(true);
    setBusinessFollowerCount((c) => c + 1);
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>{listing.title}</h1>
        <p style={{ opacity: 0.85 }}>{business?.name || 'Business'} · {listing.category} · {listing.business_age_years ?? 0} years · {[listing.city, listing.state, listing.country].filter(Boolean).join(', ')}</p>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {viewerId && viewerId !== listing.seller_id ? (
              <button onClick={toggleFollowSeller} style={ghostBtn}>{isFollowingSeller ? 'Unfollow Seller' : 'Follow Seller'}</button>
            ) : null}
            {listing.business_id ? (
              <button onClick={toggleFollowBusiness} style={ghostBtn}>{isFollowingBusiness ? 'Unfollow Business' : 'Follow Business'}</button>
            ) : null}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 8 }}>
            {sellerFollowerCount} seller follower{sellerFollowerCount === 1 ? '' : 's'}{listing.business_id ? ` · ${businessFollowerCount} business follower${businessFollowerCount === 1 ? '' : 's'}` : ''}
          </div>
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

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button onClick={toggleFavorite} style={ghostBtn}>{isFavorite ? '★ Saved' : '☆ Favorite'}</button>
          {isOwner ? (
            <a href={`/listings/edit?id=${listing.id}`} style={btn}>Edit Listing</a>
          ) : (
            <a href={`/messages?seller=${listing.seller_id}&listing=${listing.id}`} style={btn}>Message Seller</a>
          )}
          <a href='/' style={ghostBtn}>Back home</a>
        </div>
        {msg ? <p style={{ opacity: 0.85 }}>{msg}</p> : null}
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
