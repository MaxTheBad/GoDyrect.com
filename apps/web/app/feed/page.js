'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FeedPage() {
  const [rows, setRows] = useState([]);
  const [profileNames, setProfileNames] = useState({});
  const [businessNames, setBusinessNames] = useState({});
  const [businessLocations, setBusinessLocations] = useState({});
  const [mediaByListing, setMediaByListing] = useState({});
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
        r.zip,
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
        .select('id,seller_id,business_id,title,description,category,lister_role,asking_price,city,state,country,zip,created_at,is_active,is_sold')
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

        <div style={{ display: 'grid', gap: 12 }}>
          {filteredRows.map((r) => {
            const media = mediaByListing[r.id] || [];
            return (
              <article key={r.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'start' }}>
                  <div>
                    <strong>{r.title}</strong>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      {(businessNames[r.business_id] || 'Business')} · Posted by {profileNames[r.seller_id] || 'User'} · {r.lister_role || 'Authorized Representative'}
                    </div>
                    <div style={{ opacity: 0.72, fontSize: 12 }}>{[r.city, r.state, r.zip].filter(Boolean).join(', ') || businessLocations[r.business_id] || 'Location not set'}</div>
                  </div>
                  <a href={`/listing?id=${r.id}`} style={btnGhost}>Open</a>
                </div>

                {r.description ? <p style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{r.description}</p> : null}

                {media.length ? (
                  <div style={mediaWrap}>
                    {media.slice(0, 6).map((m, i) => (
                      <div key={m.url + i} style={thumbCard}>
                        {m.media_type === 'video' ? (
                          <video src={m.url} controls style={thumb} />
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

const wrap = { minHeight: '100vh', background: '#0b1020', color: '#fff' };
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
const heroContent = { position: 'relative', zIndex: 1, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '48px 16px 40px' };
const heroPanel = {
  width: 'min(1040px, 100%)',
  display: 'grid',
  gap: 16,
  justifyItems: 'center',
  textAlign: 'center',
  padding: '28px 22px 22px',
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
  width: 'min(880px, 100%)',
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
const searchBtn = { border: 0, background: '#ff8a00', color: '#fff', padding: '0 28px', fontSize: 18, fontWeight: 800, cursor: 'pointer' };
const statsRow = { width: 'min(980px, 100%)', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 14 };
const statCard = { borderRadius: 18, padding: '14px 16px', background: 'rgba(12,18,39,0.66)', border: '1px solid rgba(94,128,202,0.28)', textAlign: 'left' };
const statLabel = { display: 'block', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(159,192,255,0.92)' };
const statValue = { display: 'block', marginTop: 8, fontSize: 24, color: '#fff' };
const inner = { width: 'min(980px, calc(100% - 32px))', margin: '0 auto', padding: '0 0 90px' };
const statusText = { margin: '16px 0 0', color: '#cdd9ff' };
const card = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(17,24,39,0.06)', color: '#fff' };
const btnGhost = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const mediaWrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 10 };
const thumbCard = { border: '1px solid #eceff5', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' };
const thumb = { width: '100%', height: 120, objectFit: 'cover', display: 'block' };
const emptyState = { marginTop: 12, padding: 14, borderRadius: 14, border: '1px solid #304178', background: '#0e1738', display: 'grid', gap: 8 };
const bottomExploreWrap = { marginTop: 16, display: 'flex', justifyContent: 'center' };
const exploreBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 14px', textDecoration: 'none', fontWeight: 600 };
const srOnly = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 };
