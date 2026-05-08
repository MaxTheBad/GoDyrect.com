'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function BusinessProfilePage() {
  const [id, setId] = useState('');
  const [business, setBusiness] = useState(null);
  const [rows, setRows] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [viewerId, setViewerId] = useState('');
  const [isFollowing, setIsFollowing] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setId(new URLSearchParams(window.location.search).get('id') || '');
  }, []);

  useEffect(() => {
    async function load() {
      if (!supabase || !id) return;

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id || '';
      setViewerId(uid);

      const [{ data: b, error: bErr }, { data: listings }, { data: follows }] = await Promise.all([
        supabase.from('businesses').select('id,name,description,category,start_date,annual_revenue,annual_profit,city,state,country').eq('id', id).maybeSingle(),
        supabase.from('listings').select('id,title,asking_price,created_at').eq('business_id', id).eq('is_active', true).eq('is_sold', false).order('created_at', { ascending: false }).limit(30),
        supabase.from('business_follows').select('follower_user_id').eq('business_id', id),
      ]);

      if (bErr) return setMsg(bErr.message);
      setBusiness(b || null);
      setRows(listings || []);
      setFollowerCount((follows || []).length);

      if (uid) {
        const { data: mine } = await supabase.from('business_follows').select('business_id').eq('follower_user_id', uid).eq('business_id', id).maybeSingle();
        setIsFollowing(Boolean(mine));
      }
    }
    load();
  }, [id]);

  async function toggleFollow() {
    if (!supabase || !viewerId || !id) return;
    if (isFollowing) {
      const { error } = await supabase.from('business_follows').delete().eq('follower_user_id', viewerId).eq('business_id', id);
      if (error) return setMsg(error.message);
      setIsFollowing(false);
      setFollowerCount((c) => Math.max(c - 1, 0));
      return;
    }
    const { error } = await supabase.from('business_follows').insert({ follower_user_id: viewerId, business_id: id });
    if (error) return setMsg(error.message);
    setIsFollowing(true);
    setFollowerCount((c) => c + 1);
  }

  if (!id) return <main style={wrap}><div style={card}><p>Missing business id.</p></div></main>;
  if (!business) return <main style={wrap}><div style={card}><p>{msg || 'Loading business...'}</p></div></main>;

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={heroTop}>
          <div style={brandMark}>{(business.name || 'B').slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, color: '#fff', fontSize: 'clamp(28px, 5vw, 44px)' }}>{business.name}</h1>
            <div style={muted}>{business.category || 'Business'} · {[business.city, business.state, business.country].filter(Boolean).join(', ') || 'Location not set'}</div>
            <div style={muted}>{followerCount} follower{followerCount === 1 ? '' : 's'}</div>
          </div>
          {viewerId ? <button style={btn} onClick={toggleFollow}>{isFollowing ? 'Unfollow Business' : 'Follow Business'}</button> : null}
        </div>
        {business.description ? <p style={{ whiteSpace: 'pre-wrap', color: 'rgba(255,255,255,0.86)', marginTop: 6, lineHeight: 1.6 }}>{business.description}</p> : null}

        <section style={section}>
          <strong style={{ color: '#fff' }}>Active posts</strong>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {rows.map((r) => (
              <a key={r.id} href={`/listing?id=${r.id}`} style={rowLink}>
                <span>{r.title}</span>
                <strong>${Number(r.asking_price || 0).toLocaleString()}</strong>
              </a>
            ))}
            {rows.length === 0 ? <small style={{ opacity: 0.75, color: 'rgba(255,255,255,0.75)' }}>No active posts yet.</small> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 920, margin: '0 auto', display: 'grid', gap: 14, background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 24, padding: 18, boxShadow: '0 24px 60px rgba(0,0,0,0.28)' };
const heroTop = { display: 'grid', gridTemplateColumns: '56px minmax(0, 1fr) auto', gap: 14, alignItems: 'center' };
const brandMark = { width: 56, height: 56, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #ffd6e8, #c7d6ff)', color: '#0f172a', fontWeight: 800, fontSize: 22 };
const muted = { marginTop: 4, color: 'rgba(255,255,255,0.72)', fontSize: 14 };
const section = { marginTop: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(42,60,120,0.8)', borderRadius: 16, padding: 14 };
const rowLink = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '10px 12px', border: '1px solid rgba(42,60,120,0.8)', borderRadius: 12, color: '#fff', textDecoration: 'none', background: 'rgba(255,255,255,0.03)' };
const btn = { border: '1px solid #2a3c78', borderRadius: 999, background: '#2e7dff', color: '#fff', padding: '10px 14px', width: 'fit-content', cursor: 'pointer' };
