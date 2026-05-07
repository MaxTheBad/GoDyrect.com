'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FeedPage() {
  const [rows, setRows] = useState([]);
  const [profileNames, setProfileNames] = useState({});
  const [businessNames, setBusinessNames] = useState({});
  const [businessLocations, setBusinessLocations] = useState({});
  const [mediaByListing, setMediaByListing] = useState({});
  const [activeMediaByListing, setActiveMediaByListing] = useState({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [industry, setIndustry] = useState('all');

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      const haystack = [
        r.title,
        r.description,
        businessNames[r.business_id],
        businessLocations[r.business_id],
        profileNames[r.seller_id],
        r.category,
        r.city,
        r.state,
        r.country,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const matchesIndustry = industry === 'all' || r.category === industry;
      return matchesSearch && matchesIndustry;
    });
  }, [rows, searchTerm, industry, businessNames, businessLocations, profileNames]);

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

      const [{ data: followedUsers }, { data: followedBusinesses }] = await Promise.all([
        supabase.from('user_follows').select('followed_user_id').eq('follower_user_id', uid),
        supabase.from('business_follows').select('business_id').eq('follower_user_id', uid),
      ]);

      const userIds = (followedUsers || []).map((r) => r.followed_user_id);
      const businessIds = (followedBusinesses || []).map((r) => r.business_id);

      if (!userIds.length && !businessIds.length) {
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

  return (
    <main style={wrap}>
      <section style={heroShell}>
        <div style={heroOverlay} />
        <div style={heroContent}>
          <div style={heroPanel}>
            <div style={heroTopline}>Discover deals, businesses, and brokers</div>
            <h1 style={heroTitle}>Find a business for sale</h1>
            <p style={heroSubtitle}>Search by business name, city, state, or ZIP. Keep your feed focused on what you actually want to buy.</p>

            <div style={heroTabs}>
              <button type='button' style={industry === 'all' ? activeTab : tabButton} onClick={() => setIndustry('all')}>Businesses</button>
              <button type='button' style={industry === 'startup' ? activeTab : tabButton} onClick={() => setIndustry('startup')}>Franchises</button>
            </div>

            <div style={searchBar}>
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-search'>Search</label>
                <input
                  id='feed-search'
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder='California, Miami, 33101, coffee shop...'
                  style={searchInput}
                />
              </div>
              <div style={divider} />
              <div style={searchFieldWrap}>
                <label style={srOnly} htmlFor='feed-industry'>Industry</label>
                <select id='feed-industry' value={industry} onChange={(e) => setIndustry(e.target.value)} style={searchSelect}>
                  <option value='all'>All Industries</option>
                  <option value='established'>Established Businesses</option>
                  <option value='asset_sale'>Asset Sales</option>
                  <option value='real_estate'>Real Estate</option>
                  <option value='startup'>Start-Ups</option>
                </select>
              </div>
              <button type='button' style={searchBtn}>Search</button>
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
        </div>
      </section>

      <div style={inner}>
        {loading ? <p style={statusText}>Loading feed...</p> : null}
        {msg ? <p style={statusText}>{msg}</p> : null}
        {!loading && !msg && filteredRows.length === 0 ? (
          <div style={emptyState}>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              No posts yet. Follow people or businesses to populate your feed.
            </p>
            <p style={{ marginTop: 0, marginBottom: 8 }}>
              You can also visit Explore to discover new listings and businesses.
            </p>
            <a href="/explore" style={exploreBtn}>Go to Explore</a>
          </div>
        ) : null}

        <div style={feedColumn}>
        {filteredRows.map((r) => {
          const media = mediaByListing[r.id] || [];
          const heroMedia = media[0];
          const activeIndex = activeMediaByListing[r.id] ?? 0;
          const activeMedia = media[activeIndex] || heroMedia;
          return (
            <article key={r.id} style={postCard}>
                <div style={postTopRow}>
                  <div style={avatar}>{(r.title || 'B').slice(0, 1).toUpperCase()}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={postTitle}>{r.title}</div>
                    <div style={postMeta}>
                      <span style={postBusiness}>{businessNames[r.business_id] || 'Business'}</span>
                      <span>·</span>
                      <span>Posted by {profileNames[r.seller_id] || 'User'}</span>
                      <span>·</span>
                      <span>{r.lister_role || 'Authorized Representative'}</span>
                    </div>
                    <div style={postLocation}>{[r.city, r.state].filter(Boolean).join(', ') || businessLocations[r.business_id] || 'Location not set'}</div>
                  </div>
                  <a href={`/listing?id=${r.id}`} style={openPill}>Open</a>
                </div>

                {activeMedia ? (
                  <div style={heroMediaFrame}>
                    {activeMedia.media_type === 'video' ? (
                      <video src={activeMedia.url} controls playsInline style={heroMediaAsset} />
                    ) : (
                      <img src={activeMedia.thumbnail_url || activeMedia.url} alt='listing media' style={heroMediaAsset} />
                    )}
                    {r.description ? (
                      <div style={mediaCaption}>{r.description}</div>
                    ) : null}
                    {media.length > 1 ? (
                      <>
                        <button
                          type='button'
                          aria-label='Previous media'
                          style={carouselArrowLeft}
                          onClick={() => setActiveMediaByListing((prev) => ({
                            ...prev,
                            [r.id]: (activeIndex - 1 + media.length) % media.length,
                          }))}
                        >
                          ‹
                        </button>
                        <button
                          type='button'
                          aria-label='Next media'
                          style={carouselArrowRight}
                          onClick={() => setActiveMediaByListing((prev) => ({
                            ...prev,
                            [r.id]: (activeIndex + 1) % media.length,
                          }))}
                        >
                          ›
                        </button>
                        <div style={carouselDots}>
                          {media.map((m, idx) => (
                            <button
                              key={m.url + idx}
                              type='button'
                              aria-label={`Show media ${idx + 1} of ${media.length}`}
                              style={idx === activeIndex ? activeDot : dot}
                              onClick={() => setActiveMediaByListing((prev) => ({ ...prev, [r.id]: idx }))}
                            />
                          ))}
                          <span style={carouselCount}>{activeIndex + 1}/{media.length}</span>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {media.length > 1 ? (
                  <div style={thumbStrip}>
                    {media.slice(1, 5).map((m, i) => (
                      <div key={m.url + i} style={thumbCard}>
                        {m.media_type === 'video' ? (
                          <video src={m.url} controls playsInline style={thumb} />
                        ) : (
                          <img src={m.thumbnail_url || m.url} alt='listing media' style={thumb} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
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
  width: 'min(760px, 100%)',
  display: 'grid',
  gap: 16,
  justifyItems: 'center',
  textAlign: 'center',
  padding: '28px 18px 22px',
  borderRadius: 24,
  border: '1px solid rgba(64, 104, 184, 0.45)',
  background: 'rgba(7, 12, 30, 0.40)',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)',
  backdropFilter: 'blur(8px)',
};
const heroTopline = { fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: '#9fc0ff' };
const heroTitle = { margin: 0, fontSize: 'clamp(40px, 7vw, 78px)', lineHeight: 0.95, fontWeight: 800, color: '#fff', textShadow: '0 8px 24px rgba(0,0,0,0.35)' };
const heroSubtitle = { margin: 0, maxWidth: 760, fontSize: 18, lineHeight: 1.5, color: 'rgba(235,241,255,0.88)' };
const heroTabs = { display: 'inline-flex', gap: 8, padding: 6, borderRadius: 999, background: 'rgba(12,18,39,0.72)', border: '1px solid rgba(94,128,202,0.34)' };
const tabButton = { border: 0, borderRadius: 999, background: 'transparent', color: 'rgba(255,255,255,0.85)', padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer' };
const activeTab = { ...tabButton, background: '#ffffff', color: '#1457d6', boxShadow: '0 6px 16px rgba(0,0,0,0.18)' };
const searchBar = {
  width: 'min(620px, 100%)',
  display: 'grid',
  gridTemplateColumns: '1fr',
  alignItems: 'stretch',
  borderRadius: 18,
  overflow: 'hidden',
  background: '#fff',
  boxShadow: '0 18px 40px rgba(4, 10, 28, 0.24)',
};
const searchFieldWrap = { display: 'grid', borderBottom: '1px solid #e1e7f2' };
const divider = { display: 'none' };
const searchInput = { width: '100%', border: 0, padding: '18px 18px', fontSize: 16, outline: 'none', color: '#0f172a' };
const searchSelect = { width: '100%', border: 0, padding: '18px 18px', fontSize: 16, outline: 'none', color: '#334155', background: 'transparent' };
const searchBtn = { border: 0, background: '#ff8a00', color: '#fff', padding: '16px 28px', fontSize: 16, fontWeight: 800, cursor: 'pointer' };
const statsRow = { width: 'min(620px, 100%)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 };
const statCard = { borderRadius: 18, padding: '14px 16px', background: 'rgba(12,18,39,0.66)', border: '1px solid rgba(94,128,202,0.28)', textAlign: 'left' };
const statLabel = { display: 'block', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(159,192,255,0.92)' };
const statValue = { display: 'block', marginTop: 8, fontSize: 24, color: '#fff' };
const inner = { width: 'min(980px, calc(100% - 32px))', margin: '0 auto', padding: '0 0 90px' };
const feedColumn = {
  width: 'min(470px, calc(100vw - 24px))',
  margin: '18px auto 0',
  display: 'grid',
  gap: 16,
};
const statusText = { margin: '16px 0 0', color: '#cdd9ff' };
const postCard = {
  background: '#f8f8fb',
  border: '1px solid #e7e7ee',
  borderRadius: 24,
  padding: 14,
  boxShadow: '0 12px 30px rgba(15,23,42,0.07)',
  color: '#0f172a',
};
const btnGhost = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const heroMediaFrame = { position: 'relative', width: '100%', maxWidth: 470, margin: '0 auto', borderRadius: 20, overflow: 'hidden', background: '#0f172a', border: '1px solid #e5e7eb' };
const heroMediaAsset = { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' };
const thumbStrip = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 10, maxWidth: 470, marginLeft: 'auto', marginRight: 'auto' };
const thumbCard = { border: '1px solid #e3e7ef', borderRadius: 14, overflow: 'hidden', background: '#f7f9fc' };
const thumb = { width: '100%', height: 110, objectFit: 'cover', display: 'block' };
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
const emptyState = { marginTop: 12, padding: 14, borderRadius: 14, border: '1px solid #304178', background: '#0e1738', display: 'grid', gap: 8 };
const bottomExploreWrap = { marginTop: 16, display: 'flex', justifyContent: 'center' };
const exploreBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 14px', textDecoration: 'none', fontWeight: 600 };
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };
const postTopRow = { display: 'grid', gridTemplateColumns: '42px minmax(0, 1fr) auto', gap: 14, alignItems: 'start' };
const avatar = {
  width: 42,
  height: 42,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 18,
};
const postTitle = { fontSize: 18, lineHeight: 1.2, fontWeight: 800, color: '#0f172a', marginBottom: 2 };
const postMeta = { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 13, color: '#475569', alignItems: 'center' };
const postBusiness = { fontWeight: 700, color: '#1f2937' };
const postLocation = { marginTop: 2, fontSize: 13, color: '#64748b' };
const openPill = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 88,
  height: 54,
  padding: '0 18px',
  borderRadius: 999,
  border: '1px solid #d7dbe5',
  background: '#fff',
  color: '#111827',
  textDecoration: 'none',
  fontWeight: 800,
  fontSize: 18,
  boxShadow: '0 1px 0 rgba(255,255,255,0.8) inset',
};
