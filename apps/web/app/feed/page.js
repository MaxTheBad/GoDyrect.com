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
        r.zip,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesSearch = !q || haystack.includes(q);
      const matchesIndustry = industry === 'all' || r.category === industry;
      return matchesSearch && matchesIndustry;
    });
  }, [rows, searchTerm, industry, businessNames, profileNames]);

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
        <section style={heroCard}>
          <h1 style={heroTitle}>Feed</h1>
          <div style={heroBadgeRow}>
            <div style={badge('buyer')}>Businesses</div>
            <div style={badge('broker')}>Listings</div>
          </div>

          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder='Search businesses, posts, sellers, cities...'
            style={field}
          />
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} style={field}>
            <option value='all'>All industries</option>
            <option value='established'>Established businesses</option>
            <option value='asset_sale'>Asset sales</option>
            <option value='real_estate'>Real estate</option>
            <option value='startup'>Start-ups</option>
          </select>
          <button type='button' style={btnPrimary}>Search</button>

          <div style={heroMetaRow}>
            <span>{rows.length.toLocaleString()} posts</span>
            <span>{Object.keys(businessNames).length.toLocaleString()} businesses</span>
            <span>{Object.keys(profileNames).length.toLocaleString()} people</span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'start' }}>
                  <div>
                    <strong>{r.title}</strong>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>
                      {(businessNames[r.business_id] || 'Business')} · Posted by {profileNames[r.seller_id] || 'User'} · {r.lister_role || 'Authorized Representative'}
                    </div>
                    <div style={{ opacity: 0.72, fontSize: 12 }}>{[r.city, r.state, r.zip].filter(Boolean).join(', ') || 'Location not set'}</div>
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

const wrap = { minHeight: '100vh', background: 'radial-gradient(circle at top right, #ffe7f1 0%, #f8fafc 40%, #f8fafc 100%)', padding: '20px 16px 90px' };
const inner = { maxWidth: 560, margin: '0 auto' };
const heroCard = { maxWidth: 560, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12, border: '1px solid #2a3c78', boxShadow: '0 8px 24px rgba(17,24,39,0.06)', marginBottom: 16 };
const heroTitle = { margin: 0, fontSize: 40, color: '#fff' };
const heroBadgeRow = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 };
const heroMetaRow = { display: 'flex', gap: 12, flexWrap: 'wrap', color: '#8fb7ff', fontSize: 13, paddingTop: 4 };
const field = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const card = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(17,24,39,0.06)', color: '#fff' };
const btnPrimary = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px', cursor: 'pointer' };
const btnGhost = { border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const mediaWrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 10 };
const thumbCard = { border: '1px solid #eceff5', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' };
const thumb = { width: '100%', height: 120, objectFit: 'cover', display: 'block' };
const emptyState = { marginTop: 12, padding: 14, borderRadius: 14, border: '1px solid #304178', background: '#0e1738', display: 'grid', gap: 8 };
const bottomExploreWrap = { marginTop: 16, display: 'flex', justifyContent: 'center' };
const exploreBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #304178', borderRadius: 8, background: '#0e1738', color: '#fff', padding: '10px 14px', textDecoration: 'none', fontWeight: 600 };
