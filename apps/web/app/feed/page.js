'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { FeedEmptyState, FeedPost } from './feed-components';

export default function FeedPage() {
  const [rows, setRows] = useState([]);
  const [profileNames, setProfileNames] = useState({});
  const [businessNames, setBusinessNames] = useState({});
  const [businessLocations, setBusinessLocations] = useState({});
  const [mediaByListing, setMediaByListing] = useState({});
  const [activeMediaByListing, setActiveMediaByListing] = useState({});
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [hasFollows, setHasFollows] = useState(false);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFeed() {
      if (!supabase) return;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setMsg('Please sign in to view your feed.');
        setLoading(false);
        return;
      }

      const { data: favoriteRows } = await supabase
        .from('favorites')
        .select('listing_id')
        .eq('user_id', uid);
      setFavoriteIds((favoriteRows || []).map((r) => r.listing_id));

      const [{ data: followedUsers }, { data: followedBusinesses }] = await Promise.all([
        supabase.from('user_follows').select('followed_user_id').eq('follower_user_id', uid),
        supabase.from('business_follows').select('business_id').eq('follower_user_id', uid),
      ]);

      const userIds = (followedUsers || []).map((r) => r.followed_user_id);
      const businessIds = (followedBusinesses || []).map((r) => r.business_id);
      const followsExist = Boolean(userIds.length || businessIds.length);
      setHasFollows(followsExist);

      if (!followsExist) {
        setRows([]);
        setLoading(false);
        return;
      }

      let query = supabase
        .from('listings')
        .select('id,seller_id,business_id,title,description,category,lister_role,asking_price,city,state,country,created_at,is_active,is_sold')
        .eq('is_active', true)
        .eq('is_sold', false)
        .order('created_at', { ascending: false })
        .limit(120);

      if (userIds.length && businessIds.length) {
        query = query.or(`seller_id.in.(${userIds.join(',')}),business_id.in.(${businessIds.join(',')})`);
      } else if (userIds.length) {
        query = query.in('seller_id', userIds);
      } else {
        query = query.in('business_id', businessIds);
      }

      const { data: listings, error } = await query;
      if (error) {
        setMsg(error.message);
        setLoading(false);
        return;
      }

      const listRows = listings || [];

      const listingIds = listRows.map((r) => r.id);
      const sellerIds = [...new Set(listRows.map((r) => r.seller_id).filter(Boolean))];
      const bizIds = [...new Set(listRows.map((r) => r.business_id).filter(Boolean))];

      const [{ data: profiles }, { data: businesses }, { data: media }] = await Promise.all([
        sellerIds.length ? supabase.from('profiles').select('id,full_name,handle').in('id', sellerIds) : Promise.resolve({ data: [] }),
        bizIds.length ? supabase.from('businesses').select('id,name,city,state,zip,country,county').in('id', bizIds) : Promise.resolve({ data: [] }),
        listingIds.length
          ? supabase.from('listing_media').select('listing_id,media_type,url,thumbnail_url,sort_order').in('listing_id', listingIds)
          : Promise.resolve({ data: [] }),
      ]);

      const pMap = {};
      (profiles || []).forEach((p) => {
        pMap[p.id] = p.full_name || p.handle || 'User';
      });
      setProfileNames(pMap);

      const bMap = {};
      const lMap = {};
      (businesses || []).forEach((b) => {
        bMap[b.id] = b.name;
        lMap[b.id] = [b.city, b.state, b.zip].filter(Boolean).join(' ');
      });
      setBusinessNames(bMap);
      setBusinessLocations(lMap);
      const activeMap = {};
      listRows.forEach((row) => {
        activeMap[row.id] = 0;
      });
      setActiveMediaByListing(activeMap);

      const mMap = {};
      (media || []).forEach((m) => {
        if (!m?.url) return;
        if (!mMap[m.listing_id]) mMap[m.listing_id] = [];
        mMap[m.listing_id].push(m);
      });
      Object.keys(mMap).forEach((id) => {
        mMap[id].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      });
      setMediaByListing(mMap);

      const ordered = [...listRows].sort((a, b) => {
        const aHasMedia = (mMap[a.id] || []).length > 0 ? 1 : 0;
        const bHasMedia = (mMap[b.id] || []).length > 0 ? 1 : 0;
        if (aHasMedia !== bHasMedia) return bHasMedia - aHasMedia;
        return new Date(b.created_at) - new Date(a.created_at);
      });
      setRows(ordered);
      setLoading(false);
    }

    loadFeed();
  }, []);

  async function toggleFavorite(listingId) {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setMsg('Please sign in to save favorites.');
      return;
    }

    const isFavorite = favoriteIds.includes(listingId);
    if (isFavorite) {
      const { error } = await supabase.from('favorites').delete().eq('user_id', uid).eq('listing_id', listingId);
      if (error) return setMsg(error.message);
      setFavoriteIds((prev) => prev.filter((id) => id !== listingId));
      return;
    }

    const { error } = await supabase.from('favorites').insert({ user_id: uid, listing_id: listingId });
    if (error) return setMsg(error.message);
    setFavoriteIds((prev) => [...prev, listingId]);
  }

  return (
    <main style={wrap}>
      <div style={inner}>
        <div style={feedHeader}>
          <div style={feedHeaderCopy}>
            <p style={feedEyebrow}>Feed</p>
            <h1 style={feedTitle}>Posts from people and businesses you follow</h1>
            <p style={feedSubtitle}>This is your timeline. Search and filters live on Explore.</p>
          </div>
          <div style={statsRow}>
            <div style={statCard}>
              <span style={statLabel}>Posts</span>
              <strong style={statValue}>{rows.length.toLocaleString()}</strong>
            </div>
            <div style={statCard}>
              <span style={statLabel}>Businesses</span>
              <strong style={statValue}>{Object.keys(businessNames).length.toLocaleString()}</strong>
            </div>
            <div style={statCard}>
              <span style={statLabel}>People</span>
              <strong style={statValue}>{Object.keys(profileNames).length.toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {loading ? <p style={statusText}>Loading feed...</p> : null}
        {msg ? <p style={statusText}>{msg}</p> : null}
        <FeedEmptyState loading={loading} msg={msg} hasFollows={hasFollows} />

        <div style={hasFollows ? feedColumn : feedColumnTight}>
          {rows.map((r) => {
            const media = mediaByListing[r.id] || [];
            const activeIndex = activeMediaByListing[r.id] ?? 0;
            return (
              <FeedPost
                key={r.id}
                listing={r}
                businessName={businessNames[r.business_id]}
                businessLocation={businessLocations[r.business_id]}
                sellerName={profileNames[r.seller_id]}
                media={media}
                activeIndex={activeIndex}
                onPrev={() => setActiveMediaByListing((prev) => ({ ...prev, [r.id]: (activeIndex - 1 + media.length) % media.length }))}
                onNext={() => setActiveMediaByListing((prev) => ({ ...prev, [r.id]: (activeIndex + 1) % media.length }))}
                onPick={(idx) => setActiveMediaByListing((prev) => ({ ...prev, [r.id]: idx }))}
                onOpen={`/listing?id=${r.id}`}
                isFavorite={favoriteIds.includes(r.id)}
                onToggleFavorite={() => toggleFavorite(r.id)}
              />
            );
          })}
        </div>

        <div style={bottomExploreWrap}>
          <a href="/explore" style={exploreBtn}>Explore more listings</a>
        </div>
      </div>
    </main>
  );
}

function badge(role) {
  const map = {
    buyer: '#1e3a8a',
    seller: '#124d2f',
    broker: '#5b4b16',
  };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    width: 'fit-content',
    padding: '6px 10px',
    borderRadius: 999,
    background: map[role] || '#1e3a8a',
    border: '1px solid #3a4f8f',
    fontSize: 12,
    color: '#fff',
  };
}

const wrap = { minHeight: '100vh', background: '#0b1020', color: '#fff', overflowX: 'hidden' };
const heroShell = {
  position: 'relative',
  minHeight: '100vh',
  backgroundImage: "url('/bg.jpg')",
  backgroundSize: 'cover',
  backgroundPosition: 'center',
  overflow: 'hidden',
};
const heroOverlay = {
  position: 'absolute',
  inset: 0,
  background: 'linear-gradient(180deg, rgba(6,10,24,0.35) 0%, rgba(11,16,32,0.8) 52%, rgba(11,16,32,0.98) 100%)',
};
const heroContent = { position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 16px 32px' };
const heroPanel = {
  width: 'min(1080px, 100%)',
  display: 'grid',
  gap: 16,
  justifyItems: 'center',
  textAlign: 'center',
  padding: '20px 0 8px',
  borderRadius: 0,
  border: 0,
  background: 'transparent',
  boxShadow: 'none',
  backdropFilter: 'none',
};
const heroTopline = { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
const heroTitle = { margin: 0, fontSize: 'clamp(40px, 7vw, 78px)', lineHeight: 0.95, fontWeight: 800, color: '#fff', textShadow: '0 8px 24px rgba(0,0,0,0.35)' };
const heroSubtitle = { margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.5, color: 'rgba(235,241,255,0.88)' };
const heroTabs = { display: 'inline-flex', gap: 8, padding: 6, borderRadius: 999, background: 'rgba(12,18,39,0.72)', border: '1px solid rgba(94,128,202,0.34)' };
const tabButton = { border: 0, borderRadius: 999, background: 'transparent', color: 'rgba(255,255,255,0.85)', padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const activeTab = { ...tabButton, background: '#ffffff', color: '#1457d6', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' };
const heroSearchWrap = { width: 'min(100%, 980px)', display: 'grid', gap: 14, justifyItems: 'center' };
const searchBar = {
  width: 'min(100%, 980px)',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.35fr) 1px minmax(220px, 0.95fr) auto',
  alignItems: 'stretch',
  borderRadius: 18,
  overflow: 'hidden',
  background: '#fff',
  boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)',
};
const searchFieldWrap = { display: 'grid' };
const divider = { width: 1, background: '#e1e7f2' };
const searchInput = { width: '100%', border: 0, padding: '22px 20px', fontSize: 18, outline: 'none', color: '#0f172a' };
const searchSelect = { width: '100%', border: 0, padding: '22px 18px', fontSize: 18, outline: 'none', color: '#334155', background: 'transparent' };
const searchBtn = {
  border: '1px solid #2a3c78',
  background: '#2e7dff',
  color: '#fff',
  padding: '0 34px',
  fontSize: 18,
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 8px 20px rgba(46,125,255,0.28)',
};
const statsRow = { width: 'min(100%, 980px)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 };
const statCard = { borderRadius: 18, padding: '14px 16px', background: 'rgba(12,18,39,0.66)', border: '1px solid rgba(94,128,202,0.28)', textAlign: 'left' };
const statLabel = { display: 'block', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(159,192,255,0.92)' };
const statValue = { display: 'block', marginTop: 8, fontSize: 24, color: '#fff' };
const inner = { width: 'min(980px, calc(100% - 32px))', margin: '0 auto', padding: '0 0 90px' };
const feedHeader = { paddingTop: 18, display: 'grid', gap: 16 };
const feedHeaderCopy = { display: 'grid', gap: 6 };
const feedEyebrow = { margin: 0, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
const feedTitle = { margin: 0, fontSize: 'clamp(24px, 4vw, 34px)', lineHeight: 1.1, color: '#fff' };
const feedSubtitle = { margin: 0, color: 'rgba(235,241,255,0.78)', lineHeight: 1.5, maxWidth: 760 };
const feedColumn = {
  width: 'min(470px, calc(100vw - 24px))',
  margin: '6px auto 0',
  display: 'grid',
  gap: 16,
};
const feedColumnTight = {
  ...feedColumn,
  marginTop: 8,
};
const statusText = { margin: '16px 0 0', color: '#cdd9ff' };
const bottomExploreWrap = { marginTop: 16, display: 'flex', justifyContent: 'center' };
const exploreBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 14px', textDecoration: 'none', fontWeight: 600 };
const postShell = {
  color: '#fff',
  padding: 0,
};
const btnGhost = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const heroMediaFrame = { position: 'relative', width: '100%', maxWidth: 470, margin: '0 auto', borderRadius: 20, overflow: 'hidden', background: '#0f172a', border: '1px solid #e5e7eb' };
const heroMediaAsset = { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' };
const mediaCaption = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  padding: '16px 16px 14px',
  fontSize: 14,
  lineHeight: 1.4,
  color: '#fff',
  background: 'linear-gradient(180deg, rgba(15,23,42,0) 0%, rgba(15,23,42,0.78) 100%)',
  textShadow: '0 1px 2px rgba(0,0,0,0.35)',
  whiteSpace: 'pre-wrap',
  pointerEvents: 'none',
};
const carouselArrowBase = {
  position: 'absolute',
  top: '50%',
  transform: 'translateY(-50%)',
  width: 30,
  height: 30,
  borderRadius: 999,
  border: 0,
  background: 'rgba(255,255,255,0.88)',
  color: '#111827',
  fontSize: 24,
  lineHeight: '30px',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
};
const carouselArrowLeft = { ...carouselArrowBase, left: 10 };
const carouselArrowRight = { ...carouselArrowBase, right: 10 };
const carouselDots = {
  position: 'absolute',
  left: '50%',
  bottom: 10,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 8px',
  borderRadius: 999,
  background: 'rgba(15,23,42,0.45)',
  backdropFilter: 'blur(6px)',
};
const dot = {
  width: 7,
  height: 7,
  borderRadius: 999,
  border: 0,
  background: 'rgba(255,255,255,0.45)',
  padding: 0,
  cursor: 'pointer',
};
const activeDot = { ...dot, background: '#fff', width: 8, height: 8 };
const carouselCount = { marginLeft: 4, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: 0.2 };
