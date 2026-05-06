'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FeedPage() {
  const [rows, setRows] = useState([]);
  const [profileNames, setProfileNames] = useState({});
  const [businessNames, setBusinessNames] = useState({});
  const [mediaByListing, setMediaByListing] = useState({});
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [industry, setIndustry] = useState('all');
  const [isMobile, setIsMobile] = useState(false);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      const haystack = [
        r.title,
        r.description,
        businessNames[r.business_id],
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
  }, [rows, searchTerm, industry, businessNames, profileNames]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 860);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
        bizIds.length ? supabase.from('businesses').select('id,name').in('id', bizIds) : Promise.resolve({ data: [] }),
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
      (businesses || []).forEach((b) => {
        bMap[b.id] = b.name;
      });
      setBusinessNames(bMap);

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
      <div style={inner}>
        <section style={hero}>
          <div style={heroTopRow}>
            <div style={brandPill}>
              <span style={brandDot} />
              <span>GoDyrect</span>
            </div>
            <div style={heroTabs}>
              <span style={heroTabActive}>Businesses</span>
              <span style={heroTab}>Franchises</span>
            </div>
          </div>
          <h1 style={heroTitle}>Find a business for sale</h1>
          <p style={heroSubtitle}>Search the feed by business, listing title, seller, city, or category.</p>

          <div style={{
            ...searchShell,
            gridTemplateColumns: isMobile ? '1fr' : searchShell.gridTemplateColumns,
          }}>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder='Search businesses, posts, sellers, cities...'
              style={searchInput}
            />
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} style={{
              ...searchSelect,
              borderLeft: isMobile ? 0 : searchSelect.borderLeft,
              borderTop: isMobile ? '1px solid #e5e7eb' : 0,
            }}>
              <option value='all'>All industries</option>
              <option value='established'>Established businesses</option>
              <option value='asset_sale'>Asset sales</option>
              <option value='real_estate'>Real estate</option>
              <option value='startup'>Start-ups</option>
            </select>
            <button type='button' style={searchBtn}>Search</button>
          </div>

          <div style={heroStats}>
            <div style={heroStatsItem}>
              <strong>{rows.length.toLocaleString()}</strong>
              <span>Feed posts</span>
            </div>
            <div style={heroStatsItem}>
              <strong>{Object.keys(businessNames).length.toLocaleString()}</strong>
              <span>Businesses</span>
            </div>
            <div style={heroStatsItem}>
              <strong>{Object.keys(profileNames).length.toLocaleString()}</strong>
              <span>People</span>
            </div>
          </div>
        </section>

        {loading ? <p>Loading feed...</p> : null}
        {msg ? <p>{msg}</p> : null}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{r.title}</strong>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      {(businessNames[r.business_id] || 'Business')} · Posted by {profileNames[r.seller_id] || 'User'} · {r.lister_role || 'Authorized Representative'}
                    </div>
                    <div style={{ opacity: 0.72, fontSize: 12 }}>{[r.city, r.state, r.country].filter(Boolean).join(', ') || 'Location not set'}</div>
                  </div>
                  <a href={`/listing?id=${r.id}`} style={btn}>Open</a>
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

const wrap = { minHeight: '100vh', background: 'radial-gradient(circle at top right, #ffe7f1 0%, #f8fafc 40%, #f8fafc 100%)', padding: '20px 16px 90px' };
const inner = { maxWidth: 980, margin: '0 auto' };
  const hero = {
  overflow: 'hidden',
  borderRadius: 28,
  padding: '28px 24px 24px',
  marginBottom: 18,
  background: 'radial-gradient(circle at top right, rgba(46, 125, 255, 0.24), transparent 30%), linear-gradient(135deg, rgba(8, 16, 39, 0.98), rgba(16, 27, 63, 0.95))',
  color: '#fff',
  boxShadow: '0 22px 48px rgba(8, 18, 56, 0.28)',
  border: '1px solid rgba(110, 150, 255, 0.18)',
};
const heroTopRow = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' };
const brandPill = { display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 700 };
const brandDot = { width: 12, height: 12, borderRadius: 999, background: 'linear-gradient(135deg, #52c8ff, #2e7dff), linear-gradient(135deg, #ff8a00, #dd2a7b)' };
const heroTabs = { display: 'inline-flex', gap: 8, flexWrap: 'wrap' };
const heroTab = { padding: '10px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.86)', fontWeight: 700, border: '1px solid rgba(255,255,255,0.06)' };
const heroTabActive = { ...heroTab, background: '#fff', color: '#0b1020' };
const heroTitle = { margin: '22px 0 6px', fontSize: 42, lineHeight: 1.05, letterSpacing: '-0.04em' };
const heroSubtitle = { margin: 0, color: 'rgba(255,255,255,0.82)', fontSize: 16 };
const searchShell = { display: 'grid', gridTemplateColumns: '1.5fr 0.95fr auto', gap: 0, marginTop: 22, borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 36px rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.08)' };
const searchInput = { minHeight: 64, border: 0, padding: '0 18px', fontSize: 17, outline: 'none', background: '#fff', color: '#111827' };
const searchSelect = { minHeight: 64, border: 0, borderLeft: '1px solid #e5e7eb', padding: '0 16px', fontSize: 16, outline: 'none', background: '#fff', color: '#111827' };
const searchBtn = { minHeight: 64, border: 0, padding: '0 22px', background: 'linear-gradient(135deg, #2e7dff, #1b56d6)', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer' };
const heroStats = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginTop: 22 };
const heroStatsItem = { display: 'grid', gap: 4, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)' };
const card = { background: '#fff', border: '1px solid #eceff5', borderRadius: 16, padding: 12, boxShadow: '0 8px 24px rgba(17,24,39,0.06)' };
const btn = { border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', color: '#111827', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const mediaWrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 10 };
const thumbCard = { border: '1px solid #eceff5', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' };
const thumb = { width: '100%', height: 120, objectFit: 'cover', display: 'block' };
const emptyState = { marginTop: 12, padding: 14, borderRadius: 14, border: '1px solid #dbe6ff', background: '#f8fbff', display: 'grid', gap: 8 };
const bottomExploreWrap = { marginTop: 16, display: 'flex', justifyContent: 'center' };
const exploreBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #2e7dff', borderRadius: 999, background: '#2e7dff', color: '#fff', padding: '10px 14px', textDecoration: 'none', fontWeight: 700 };
