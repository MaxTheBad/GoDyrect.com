'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function FavoritesPage() {
  const [rows, setRows] = useState([]);
  const [userId, setUserId] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadFavorites() {
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        setMsg('Please sign in to view favorites.');
        setLoading(false);
        return;
      }

      setUserId(uid);

      const { data: favorites, error: favErr } = await supabase
        .from('favorites')
        .select('listing_id')
        .eq('user_id', uid);

      if (favErr) {
        setMsg(favErr.message);
        setLoading(false);
        return;
      }

      const ids = (favorites || []).map((f) => f.listing_id);
      if (!ids.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      const { data: listings, error: listErr } = await supabase
        .from('listings')
        .select('id,title,asking_price,category,city,state,country,seller_id,is_active,is_sold')
        .in('id', ids)
        .order('created_at', { ascending: false });

      if (listErr) {
        setMsg(listErr.message);
        setLoading(false);
        return;
      }

      setRows((listings || []).filter((l) => l.is_active && !l.is_sold));
      setLoading(false);
    }

    loadFavorites();
  }, []);

  async function unfavorite(listingId) {
    if (!supabase || !userId) return;
    const { error } = await supabase.from('favorites').delete().eq('user_id', userId).eq('listing_id', listingId);
    if (error) return setMsg(error.message);
    setRows((prev) => prev.filter((r) => r.id !== listingId));
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>Favorites</h1>
        <p style={{ opacity: 0.8, marginTop: -4 }}>Businesses you saved.</p>

        {loading ? <p>Loading favorites...</p> : null}
        {msg ? <p>{msg}</p> : null}
        {!loading && !msg && rows.length === 0 ? <p>No favorites yet.</p> : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={row}>
              <div>
                <strong>{r.title}</strong>
                <div style={{ opacity: 0.85, fontSize: 13 }}>{r.category} · {[r.city, r.state, r.country].filter(Boolean).join(', ')}</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>${Number(r.asking_price || 0).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a href={`/listing?id=${r.id}`} style={ghostBtn}>View</a>
                <a href={`/messages?seller=${r.seller_id}&listing=${r.id}`} style={ghostBtn}>Message</a>
                <button onClick={() => unfavorite(r.id)} style={dangerBtn}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 980, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const row = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const dangerBtn = { border: '1px solid #7a3040', borderRadius: 10, background: '#3a1520', color: '#ffd7dd', padding: '10px 12px', cursor: 'pointer' };
