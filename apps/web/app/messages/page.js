'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MessagesPage() {
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [listings, setListings] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [startSellerId, setStartSellerId] = useState('');
  const [startListingId, setStartListingId] = useState('');

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  const counterpartId = activeConversation
    ? activeConversation.buyer_id === user?.id
      ? activeConversation.seller_id
      : activeConversation.buyer_id
    : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qp = new URLSearchParams(window.location.search);
    setStartSellerId(qp.get('seller') || '');
    setStartListingId(qp.get('listing') || '');
  }, []);

  useEffect(() => {
    async function init() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      const me = data?.user;
      setUser(me || null);
      if (!me) return;

      const { data: convos, error } = await supabase
        .from('conversations')
        .select('*')
        .or(`buyer_id.eq.${me.id},seller_id.eq.${me.id}`)
        .order('created_at', { ascending: false });

      if (error) return setMsg(error.message);

      let list = convos || [];

      if (startSellerId && startSellerId !== me.id) {
        let convo = list.find(
          (c) =>
            c.buyer_id === me.id &&
            c.seller_id === startSellerId &&
            (startListingId ? c.listing_id === startListingId : true)
        );

        if (!convo) {
          const { data: created, error: cErr } = await supabase
            .from('conversations')
            .insert({ buyer_id: me.id, seller_id: startSellerId, listing_id: startListingId || null })
            .select('*')
            .single();
          if (cErr) setMsg(cErr.message);
          if (created) {
            convo = created;
            list = [created, ...list];
          }
        }

        if (convo?.id) setActiveId(convo.id);
      }

      setConversations(list);
      if (!activeId && list.length) setActiveId((prev) => prev || list[0].id);

      const counterpartIds = [...new Set(list.map((c) => (c.buyer_id === me.id ? c.seller_id : c.buyer_id)).filter(Boolean))];
      const listingIds = [...new Set(list.map((c) => c.listing_id).filter(Boolean))];

      if (counterpartIds.length) {
        const { data: prof } = await supabase.from('profiles').select('id,full_name,role,avatar_url').in('id', counterpartIds);
        const map = {};
        (prof || []).forEach((p) => (map[p.id] = p));
        setProfiles(map);
      }

      if (listingIds.length) {
        const { data: l } = await supabase.from('listings').select('id,title').in('id', listingIds);
        const map = {};
        (l || []).forEach((x) => (map[x.id] = x));
        setListings(map);
      }
    }

    init();
  }, [startSellerId, startListingId]);

  useEffect(() => {
    async function loadMessages() {
      if (!supabase || !activeId) return setMessages([]);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', activeId)
        .order('created_at', { ascending: true });
      if (error) return setMsg(error.message);
      setMessages(data || []);
    }

    loadMessages();
  }, [activeId]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!supabase || !activeId || !user || !body.trim()) return;

    const { error } = await supabase.from('messages').insert({
      conversation_id: activeId,
      sender_id: user.id,
      body: body.trim(),
    });

    if (error) return setMsg(error.message);
    setBody('');

    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', activeId)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  }

  if (!user) {
    return (
      <main style={wrap}>
        <div style={card}><h1>Messages</h1><p>Please log in to view messages.</p><a href='/login' style={{ color: '#8fb7ff' }}>Go to login</a></div>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={shell}>
        <aside style={leftPane}>
          <h2 style={{ marginTop: 0 }}>Inbox</h2>
          {conversations.length === 0 ? <p style={{ opacity: 0.8 }}>No conversations yet.</p> : null}
          {conversations.map((c) => {
            const otherId = c.buyer_id === user.id ? c.seller_id : c.buyer_id;
            const p = profiles[otherId];
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} style={{ ...threadBtn, borderColor: c.id === activeId ? '#2e7dff' : '#304178' }}>
                <strong>{p?.full_name || 'User'}</strong>
                {p?.role ? <span style={badge(p.role)}>{p.role === 'not_sure' ? 'Not sure yet' : p.role}</span> : null}
                <span style={{ opacity: 0.75, fontSize: 12 }}>{c.listing_id ? listings[c.listing_id]?.title || 'Listing' : 'General chat'}</span>
              </button>
            );
          })}
        </aside>

        <section style={rightPane}>
          <h2 style={{ marginTop: 0 }}>Conversation</h2>
          {activeConversation ? (
            <>
              <p style={{ marginTop: 0, opacity: 0.85 }}>
                With {profiles[counterpartId]?.full_name || 'User'}
                {profiles[counterpartId]?.role ? ` · ${profiles[counterpartId].role === 'not_sure' ? 'Not sure yet' : profiles[counterpartId].role}` : ''}
              </p>

              <div style={messagesWrap}>
                {messages.map((m) => {
                  const mine = m.sender_id === user.id;
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                      <div style={{ ...bubble, background: mine ? '#2e7dff' : '#1a2754' }}>{m.body}</div>
                    </div>
                  );
                })}
              </div>

              <form onSubmit={sendMessage} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 10 }}>
                <input style={input} value={body} onChange={(e) => setBody(e.target.value)} placeholder='Type a message' />
                <button style={btn} type='submit'>Send</button>
              </form>
            </>
          ) : (
            <p>Select a conversation to start messaging.</p>
          )}

          {msg ? <p>{msg}</p> : null}
        </section>
      </div>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 520, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12, border: '1px solid #2a3c78' };
const shell = { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 };
const leftPane = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 12, maxHeight: '80vh', overflow: 'auto' };
const rightPane = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 12, display: 'grid', alignContent: 'start' };
const threadBtn = { width: '100%', textAlign: 'left', border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: 10, marginBottom: 8, display: 'grid', gap: 6, cursor: 'pointer' };
const badge = (role) => ({ display: 'inline-block', width: 'fit-content', padding: '4px 8px', borderRadius: 999, background: role === 'seller' ? '#124d2f' : role === 'buyer' ? '#1e3a8a' : '#5b4b16', border: '1px solid #3a4f8f', fontSize: 11 });
const messagesWrap = { border: '1px solid #304178', borderRadius: 10, background: '#0b1431', padding: 10, minHeight: 280, maxHeight: 480, overflow: 'auto', display: 'grid', gap: 8 };
const bubble = { maxWidth: '75%', borderRadius: 12, padding: '8px 10px' };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
