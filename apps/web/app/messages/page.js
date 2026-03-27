'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MessagesPage() {
  const [sellerId, setSellerId] = useState('');
  const [listingId, setListingId] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [sellerRole, setSellerRole] = useState('');


  useEffect(() => {
    async function loadRole() {
      if (!supabase || !sellerId) return setSellerRole('');
      const { data } = await supabase.from('profiles').select('role').eq('id', sellerId).maybeSingle();
      setSellerRole(data?.role || '');
    }
    loadRole();
  }, [sellerId]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!supabase) return setMsg('Supabase env vars missing.');

    const { data: userData } = await supabase.auth.getUser();
    const buyer = userData?.user;
    if (!buyer) return setMsg('Please log in first.');

    let { data: convo } = await supabase
      .from('conversations')
      .select('id')
      .eq('buyer_id', buyer.id)
      .eq('seller_id', sellerId)
      .eq('listing_id', listingId || null)
      .maybeSingle();

    if (!convo) {
      const { data: created, error: convoErr } = await supabase
        .from('conversations')
        .insert({ buyer_id: buyer.id, seller_id: sellerId, listing_id: listingId || null })
        .select('id')
        .single();
      if (convoErr) return setMsg(convoErr.message);
      convo = created;
    }

    const { error } = await supabase.from('messages').insert({
      conversation_id: convo.id,
      sender_id: buyer.id,
      body,
    });

    setMsg(error ? error.message : 'Message sent.');
    if (!error) setBody('');
  }

  return (
    <main style={wrap}>
      <form onSubmit={sendMessage} style={card}>
        <h1>Messages</h1>
        <p style={{ marginTop: 0, opacity: 0.8 }}>Enter seller/listing id to test messaging until UI list is connected.</p>
        <input style={input} placeholder='Seller user id (uuid)' value={sellerId} onChange={(e) => setSellerId(e.target.value)} required />
        {sellerRole ? <div style={badge(sellerRole)}>Recipient: {sellerRole === 'not_sure' ? 'Not sure yet' : sellerRole}</div> : null}
        <input style={input} placeholder='Listing id (uuid, optional)' value={listingId} onChange={(e) => setListingId(e.target.value)} />
        <textarea style={input} rows={4} placeholder='Type message' value={body} onChange={(e) => setBody(e.target.value)} required />
        <button style={btn} type='submit'>Send Message</button>
        {msg ? <p>{msg}</p> : null}
        <a href='/' style={{ color: '#8fb7ff' }}>Back home</a>
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 680, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const badge = (role) => ({ display: 'inline-block', width: 'fit-content', padding: '6px 10px', borderRadius: 999, background: role === 'seller' ? '#124d2f' : role === 'buyer' ? '#1e3a8a' : '#5b4b16', border: '1px solid #3a4f8f', fontSize: 12, textTransform: 'capitalize' });
