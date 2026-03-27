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
        <h1 style={{ marginTop: 0 }}>{business.name}</h1>
        <div style={{ opacity: 0.85 }}>{business.category || 'Business'} · {[business.city, business.state, business.country].filter(Boolean).join(', ') || 'Location not set'}</div>
        <div style={{ opacity: 0.75, fontSize: 13 }}>{followerCount} follower{followerCount === 1 ? '' : 's'}</div>
        {viewerId ? <button style={btn} onClick={toggleFollow}>{isFollowing ? 'Unfollow Business' : 'Follow Business'}</button> : null}
        {business.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{business.description}</p> : null}

        <section style={section}>
          <strong>Active posts</strong>
          <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
            {rows.map((r) => (
              <a key={r.id} href={`/listing?id=${r.id}`} style={rowLink}>
                <span>{r.title}</span>
                <strong>${Number(r.asking_price || 0).toLocaleString()}</strong>
              </a>
            ))}
            {rows.length === 0 ? <small style={{ opacity: 0.75 }}>No active posts yet.</small> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 860, margin: '0 auto', display: 'grid', gap: 10, background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const section = { marginTop: 10, background: '#0e1738', border: '1px solid #304178', borderRadius: 10, padding: 10 };
const rowLink = { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid #304178', borderRadius: 8, color: '#fff', textDecoration: 'none' };
const btn = { border: 0, borderRadius: 999, background: '#2e7dff', color: '#fff', padding: '8px 12px', width: 'fit-content', cursor: 'pointer' };
