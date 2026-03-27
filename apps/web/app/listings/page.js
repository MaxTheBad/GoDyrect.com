'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MyListingsPage() {
  const [rows, setRows] = useState([]);
  const [userId, setUserId] = useState('');
  const [msg, setMsg] = useState('');
  const [businessNames, setBusinessNames] = useState({});

  async function loadListings() {
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return setMsg('Please sign in to see your listings.');
    setUserId(user.id);

    const { data, error } = await supabase
      .from('listings')
      .select('id,business_id,title,asking_price,category,lister_role,is_active,is_sold,created_at')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false });

    if (error) return setMsg(error.message);
    const listRows = data || [];
    setRows(listRows);

    const ids = [...new Set(listRows.map((r) => r.business_id).filter(Boolean))];
    if (ids.length) {
      const { data: businesses } = await supabase.from('businesses').select('id,name').in('id', ids);
      const map = {};
      (businesses || []).forEach((b) => {
        map[b.id] = b.name;
      });
      setBusinessNames(map);
    }
  }

  useEffect(() => {
    loadListings();
  }, []);

  async function deleteListing(id) {
    const ok = window.confirm('Delete this listing? This cannot be undone from the app.');
    if (!ok || !supabase || !userId) return;

    const { error } = await supabase
      .from('listings')
      .delete()
      .eq('id', id)
      .eq('seller_id', userId);

    if (error) return setMsg(error.message);

    setRows((prev) => prev.filter((r) => r.id !== id));
    setMsg('Listing deleted.');
  }

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
                <div style={{ opacity: 0.8, fontSize: 13 }}>{businessNames[r.business_id] || 'Business'} · {r.category} · ${Number(r.asking_price || 0).toLocaleString()}</div>
                <div style={{ opacity: 0.72, fontSize: 12 }}>Posted as: {r.lister_role || 'Authorized Representative'}</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>{r.is_sold ? 'Sold' : r.is_active ? 'Active' : 'Inactive'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <a href={`/listing?id=${r.id}`} style={ghostBtn}>View</a>
                <a href={`/listings/edit?id=${r.id}`} style={ghostBtn}>Edit</a>
                <button onClick={() => deleteListing(r.id)} style={dangerBtn}>Delete</button>
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
const dangerBtn = { border: '1px solid #7a3040', borderRadius: 10, background: '#3a1520', color: '#ffd7dd', padding: '10px 12px', cursor: 'pointer' };
