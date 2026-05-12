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
      window.location.href = `/login?returnTo=${encodeURIComponent(`/listing?id=${listing.id}`)}`;
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
    if (!supabase || !listing) return;
    if (!viewerId) {
      setMsg('Please sign in to follow sellers.');
      window.location.href = `/login?returnTo=${encodeURIComponent(`/listing?id=${listing.id}`)}`;
      return;
    }
    if (viewerId === listing.seller_id) return;
    if (isFollowingSeller) {
      const { error } = await supabase.from('user_follows').delete().eq('follower_user_id', viewerId).eq('followed_user_id', listing.seller_id);
      if (error) return setMsg(error.message);
      setIsFollowingSeller(false);
      setSellerFollowerCount((c) => Math.max(c - 1, 0));
      setMsg('Unfollowed seller');
      return;
    }

    const { error } = await supabase.from('user_follows').insert({ follower_user_id: viewerId, followed_user_id: listing.seller_id });
    if (error) {
      if (error.message?.includes('duplicate key')) {
        setIsFollowingSeller(true);
        return setMsg('Already following this seller');
      }
      return setMsg(error.message);
    }
    setIsFollowingSeller(true);
    setSellerFollowerCount((c) => c + 1);
    setMsg('Following seller');
  }

  async function toggleFollowBusiness() {
    if (!supabase || !listing?.business_id) return;
    if (!viewerId) {
      setMsg('Please sign in to follow businesses.');
      window.location.href = `/login?returnTo=${encodeURIComponent(`/listing?id=${listing.id}`)}`;
      return;
    }
    if (isFollowingBusiness) {
      const { error } = await supabase.from('business_follows').delete().eq('follower_user_id', viewerId).eq('business_id', listing.business_id);
      if (error) return setMsg(error.message);
      setIsFollowingBusiness(false);
      setBusinessFollowerCount((c) => Math.max(c - 1, 0));
      setMsg('Unfollowed business');
      return;
    }

    const { error } = await supabase.from('business_follows').insert({ follower_user_id: viewerId, business_id: listing.business_id });
    if (error) {
      if (error.message?.includes('schema cache') || error.message?.includes("public.business_follows")) {
        return setMsg('Business follows table is missing in Supabase cache. Run latest SQL migration and refresh.');
      }
      if (error.message?.includes('duplicate key')) {
        setIsFollowingBusiness(true);
        return setMsg('Already following this business');
      }
      return setMsg(error.message);
    }
    setIsFollowingBusiness(true);
    setBusinessFollowerCount((c) => c + 1);
    setMsg('Following business');
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={heroTop}>
          <div style={brandMark}>{(listing.title || 'L').slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, color: '#fff', fontSize: 'clamp(28px, 5vw, 44px)' }}>{listing.title}</h1>
            <p style={{ margin: '6px 0 0', opacity: 0.8, color: 'rgba(255,255,255,0.76)' }}>{listing.category} · {listing.business_age_years ?? 0} years · {[listing.city, listing.state, listing.country].filter(Boolean).join(', ')}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button onClick={toggleFavorite} style={ghostBtn}>{isFavorite ? '★ Saved' : '☆ Favorite'}</button>
            <a href={isOwner ? `/listings/edit?id=${listing.id}` : `/messages?seller=${listing.seller_id}&listing=${listing.id}`} style={btn}>{isOwner ? 'Edit Listing' : 'Message Seller'}</a>
          </div>
        </div>
        {business?.id ? (
          <a href={`/business/view?id=${business.id}`} style={businessIdentityWrap}>
            <div style={businessLogoFallback}>{(business.name || 'B').slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>{business.name}</strong>
              <div style={{ opacity: 0.72, fontSize: 12 }}>Business profile</div>
            </div>
          </a>
        ) : null}
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
            {viewerId !== listing.seller_id ? (
              <button onClick={toggleFollowSeller} style={ghostBtn}>{isFollowingSeller ? 'Unfollow Seller' : 'Follow Seller'}</button>
            ) : null}
            {listing.business_id ? (
              <button onClick={toggleFollowBusiness} style={ghostBtn}>{isFollowingBusiness ? 'Unfollow Business' : 'Follow Business'}</button>
            ) : null}
          </div>
          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 8, color: 'rgba(255,255,255,0.72)' }}>
            {sellerFollowerCount} seller follower{sellerFollowerCount === 1 ? '' : 's'}{listing.business_id ? ` · ${businessFollowerCount} business follower${businessFollowerCount === 1 ? '' : 's'}` : ''}
          </div>
        </section>

        <section style={section}>
          <h3 style={{ marginTop: 0, color: '#fff' }}>Description</h3>
          <p style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.84)' }}>{listing.description || 'No description added yet.'}</p>
        </section>

        <section style={section}>
          <h3 style={{ marginTop: 0, color: '#fff' }}>Photos & Videos</h3>
          {media.length === 0 ? <p style={{ color: 'rgba(255,255,255,0.72)' }}>No media uploaded yet.</p> : null}
          {media.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              {media.slice(0, 1).map((m) => (
                <div key={m.id} style={mediaCard}>
                  {m.media_type === 'video' ? (
                    <video controls style={mediaEl} src={m.url} />
                  ) : (
                    <img alt='Listing media' style={mediaEl} src={m.url} />
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
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
const card = { maxWidth: 1000, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 24, padding: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' };
const heroTop = { display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr) auto', gap: 14, alignItems: 'center' };
const brandMark = { width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)', color: '#0f172a', fontWeight: 800, fontSize: 22 };
const section = { marginTop: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(42,60,120,0.8)', borderRadius: 16, padding: 14 };
const sellerWrap = { display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' };
const avatar = { width: 40, height: 40, borderRadius: 999, objectFit: 'cover', border: '1px solid #e5e7eb' };
const avatarFallback = { width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#f3f4f6', border: '1px solid #e5e7eb' };
const businessIdentityWrap = { marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: '#fff' };
const businessLogoFallback = { width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: '#eef2ff', border: '1px solid #e5e7eb', color: '#334155', fontWeight: 700 };
const mediaCard = { border: '1px solid rgba(42,60,120,0.8)', borderRadius: 16, overflow: 'hidden', background: '#0e1738' };
const mediaEl = { width: '100%', height: 170, objectFit: 'cover', display: 'block' };
const btn = { border: '1px solid #2a3c78', borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
