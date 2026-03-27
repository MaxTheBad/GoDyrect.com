'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FeedPage() {
  const [rows, setRows] = useState([]);
  const [profileNames, setProfileNames] = useState({});
  const [businessNames, setBusinessNames] = useState({});
  const [mediaByListing, setMediaByListing] = useState({});
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
      setRows(listRows);

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
      setLoading(false);
    }

    loadFeed();
  }, []);

  return (
    <main style={wrap}>
      <div style={inner}>
        <h1 style={{ marginTop: 0 }}>Your Feed</h1>
        <p style={{ opacity: 0.8, marginTop: -4 }}>Posts from people and businesses you follow.</p>

        {loading ? <p>Loading feed...</p> : null}
        {msg ? <p>{msg}</p> : null}
        {!loading && !msg && rows.length === 0 ? <p>No posts yet. Follow people or businesses to populate your feed.</p> : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {rows.map((r) => {
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
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', background: 'radial-gradient(circle at top right, #ffe7f1 0%, #f8fafc 40%, #f8fafc 100%)', padding: '20px 16px 90px' };
const inner = { maxWidth: 980, margin: '0 auto' };
const card = { background: '#fff', border: '1px solid #eceff5', borderRadius: 16, padding: 12, boxShadow: '0 8px 24px rgba(17,24,39,0.06)' };
const btn = { border: '1px solid #e5e7eb', borderRadius: 999, background: '#fff', color: '#111827', padding: '8px 12px', textDecoration: 'none', fontWeight: 600 };
const mediaWrap = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginTop: 10 };
const thumbCard = { border: '1px solid #eceff5', borderRadius: 10, overflow: 'hidden', background: '#f8fafc' };
const thumb = { width: '100%', height: 120, objectFit: 'cover', display: 'block' };
