'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MyListingsPage() {
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) return setMsg('Please sign in to see your listings.');

      const { data, error } = await supabase
        .from('listings')
        .select('id,title,asking_price,category,is_active,is_sold,created_at')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return setMsg(error.message);
      setRows(data || []);
    }

    load();
  }, []);

  return (
    <main style={wrap}>
      <div style={card}>
        <h1 style={{ marginTop: 0 }}>My Listings</h1>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <a href='/listings/new' style={primaryBtn}>Post New Listing</a>
          <a href='/dashboard' style={ghostBtn}>Back to Dashboard</a>
        </div>

        {msg ? <p>{msg}</p> : null}
        {!msg && rows.length === 0 ? <p>No listings yet.</p> : null}

        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={row}>
              <div>
                <strong>{r.title}</strong>
                <div style={{ opacity: 0.8, fontSize: 13 }}>{r.category} · ${Number(r.asking_price || 0).toLocaleString()}</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>{r.is_sold ? 'Sold' : r.is_active ? 'Active' : 'Inactive'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={`/listings/${r.id}/edit`} style={ghostBtn}>Edit</a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 900, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16 };
const row = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' };
const primaryBtn = { border: 0, borderRadius: 10, background: '#2e7dff', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
const ghostBtn = { border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: '10px 12px', textDecoration: 'none' };
