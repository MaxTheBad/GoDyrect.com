'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function MessagesPage() {
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [listings, setListings] = useState({});
  const [businesses, setBusinesses] = useState({});
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState('');
  const [startSellerId, setStartSellerId] = useState('');
  const [startListingId, setStartListingId] = useState('');
  const [startBusinessId, setStartBusinessId] = useState('');
  const [replyListingId, setReplyListingId] = useState('');

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId]
  );

  const activeConversationGroup = useMemo(() => {
    if (!activeConversation) return [];
    const counterpart = activeConversation.buyer_id === user?.id ? activeConversation.seller_id : activeConversation.buyer_id;
    return conversations.filter((c) => {
      const cCounterpart = c.buyer_id === user?.id ? c.seller_id : c.buyer_id;
      return cCounterpart === counterpart && c.business_id === activeConversation.business_id;
    });
  }, [activeConversation, conversations, user?.id]);

  const counterpartId = activeConversation
    ? activeConversation.buyer_id === user?.id
      ? activeConversation.seller_id
      : activeConversation.buyer_id
    : null;

  const activeBusinessId = activeConversation?.business_id || null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const qp = new URLSearchParams(window.location.search);
    setStartSellerId(qp.get('seller') || '');
    setStartListingId(qp.get('listing') || '');
    setStartBusinessId(qp.get('business') || '');
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
        let businessId = startBusinessId || null;
        if (!businessId && startListingId) {
          const { data: listingRow } = await supabase.from('listings').select('id,business_id').eq('id', startListingId).maybeSingle();
          businessId = listingRow?.business_id || null;
        }
        let convo = list.find(
          (c) =>
            c.buyer_id === me.id &&
            c.seller_id === startSellerId &&
            (
              (businessId ? c.business_id === businessId : true) ||
              (startListingId ? c.listing_id === startListingId : false)
            )
        );

        if (!convo) {
          const { data: created, error: cErr } = await supabase
            .from('conversations')
            .insert({ buyer_id: me.id, seller_id: startSellerId, business_id: businessId, listing_id: startListingId || null })
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
      const profileIds = [...new Set([me.id, ...counterpartIds])];
      const listingIds = [...new Set(list.map((c) => c.listing_id).filter(Boolean))];
      const businessIds = [...new Set(list.map((c) => c.business_id).filter(Boolean))];

      if (profileIds.length) {
        const { data: prof } = await supabase.from('profiles').select('id,full_name,role,avatar_url').in('id', profileIds);
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

      if (businessIds.length) {
        const { data: b } = await supabase.from('businesses').select('id,name,slug').in('id', businessIds);
        const map = {};
        (b || []).forEach((x) => (map[x.id] = x));
        setBusinesses(map);
      }

      const grouped = list.reduce((acc, convo) => {
        const businessKey = convo.business_id || convo.listing_id || convo.id;
        const counterpartKey = convo.buyer_id === me.id ? convo.seller_id : convo.buyer_id;
        const key = `${counterpartKey}:${businessKey}`;
        if (!acc[key]) acc[key] = convo;
        return acc;
      }, {});
      const mergedList = Object.values(grouped);
      setConversations(mergedList);
    }

    init();
  }, [startSellerId, startListingId, startBusinessId]);

  useEffect(() => {
    async function loadMessages() {
      if (!supabase || !activeConversationGroup.length) return setMessages([]);
      const convoIds = activeConversationGroup.map((c) => c.id);
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', convoIds)
        .order('created_at', { ascending: true });
      if (error) return setMsg(error.message);
      setMessages(data || []);
      const latestReply = (data || []).slice().reverse().find((m) => m.listing_id)?.listing_id || '';
      setReplyListingId(latestReply);
    }

    loadMessages();
  }, [activeConversationGroup, activeId]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!supabase || !activeConversationGroup.length || !user || !body.trim()) return;

    const { error } = await supabase.from('messages').insert({
      conversation_id: activeConversationGroup[0].id,
      sender_id: user.id,
      listing_id: replyListingId || null,
      body: body.trim(),
    });

    if (error) return setMsg(error.message);
    setBody('');

      const { data } = await supabase
        .from('messages')
        .select('*')
        .in('conversation_id', activeConversationGroup.map((c) => c.id))
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
            const business = c.business_id ? businesses[c.business_id] : null;
            return (
              <button key={c.id} onClick={() => setActiveId(c.id)} style={{ ...threadBtn, borderColor: c.id === activeId ? '#2e7dff' : '#304178' }}>
                <strong>{business?.name || 'Business conversation'}</strong>
                <strong>{p?.full_name || 'User'}</strong>
                {p?.role ? <span style={badge(p.role)}>{p.role === 'not_sure' ? 'Not sure yet' : p.role}</span> : null}
                <span style={{ opacity: 0.75, fontSize: 12 }}>
                  {c.listing_id ? listings[c.listing_id]?.title || 'Listing' : 'General chat'}
                </span>
              </button>
            );
          })}
        </aside>

        <section style={rightPane}>
          <h2 style={{ marginTop: 0 }}>Conversation</h2>
          {activeConversation ? (
            <>
              <h3 style={{ marginTop: 0, marginBottom: 4 }}>{businesses[activeBusinessId]?.name || 'Business'}</h3>
              <p style={{ marginTop: 0, opacity: 0.85 }}>
                With {profiles[counterpartId]?.full_name || 'User'}
                {profiles[counterpartId]?.role ? ` · ${profiles[counterpartId].role === 'not_sure' ? 'Not sure yet' : profiles[counterpartId].role}` : ''}
              </p>
              {activeConversation.listing_id ? (
                <a href={`/listing?id=${activeConversation.listing_id}`} style={{ color: '#8fb7ff', fontSize: 13 }}>
                  Open original post: {listings[activeConversation.listing_id]?.title || 'View listing'}
                </a>
              ) : null}

              <div style={messagesWrap}>
                {messages.map((m, idx) => {
                  const mine = m.sender_id === user.id;
                  const sender = profiles[m.sender_id];
                  const prev = messages[idx - 1];
                  const showListingHeader = m.listing_id && m.listing_id !== prev?.listing_id;
                  return (
                    <div key={m.id} style={{ display: 'grid', gap: 8 }}>
                      {showListingHeader ? (
                        <div style={listingHeaderBlock}>
                          <div style={listingHeaderTitle}>Post: {listings[m.listing_id]?.title || 'View listing'}</div>
                          <a href={`/listing?id=${m.listing_id}`} style={listingLink}>Open linked post</a>
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexDirection: mine ? 'row-reverse' : 'row' }}>
                          <a href={`/profile/view?id=${m.sender_id}`} title='View profile' style={{ textDecoration: 'none' }}>
                            {sender?.avatar_url ? (
                              <img src={sender.avatar_url} alt='avatar' style={avatar} />
                            ) : (
                              <div style={avatarFallback}>{initial(sender?.full_name)}</div>
                            )}
                          </a>
                          <div style={{ ...bubble, background: mine ? '#2e7dff' : '#1a2754' }}>{m.body}</div>
                        </div>
                      </div>
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

function initial(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 520, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12, border: '1px solid #2a3c78' };
const shell = { display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12 };
const leftPane = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 12, maxHeight: '80vh', overflow: 'auto' };
const rightPane = { background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 12, display: 'grid', alignContent: 'start' };
const threadBtn = { width: '100%', textAlign: 'left', border: '1px solid #304178', borderRadius: 10, background: '#0e1738', color: '#fff', padding: 10, marginBottom: 8, display: 'grid', gap: 6, cursor: 'pointer' };
const badge = (role) => ({ display: 'inline-block', width: 'fit-content', padding: '4px 8px', borderRadius: 999, background: role === 'seller' ? '#124d2f' : role === 'buyer' ? '#1e3a8a' : '#5b4b16', border: '1px solid #3a4f8f', fontSize: 11 });
const messagesWrap = { border: '1px solid #304178', borderRadius: 10, background: '#0b1431', padding: 10, minHeight: 280, maxHeight: 480, overflow: 'auto', display: 'grid', gap: 8 };
const bubble = { maxWidth: 340, borderRadius: 12, padding: '6px 9px', fontSize: 14, lineHeight: 1.3 };
const avatar = { width: 28, height: 28, borderRadius: 999, objectFit: 'cover', border: '1px solid #3a4f8f' };
const avatarFallback = { width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#243569', border: '1px solid #3a4f8f', fontSize: 12 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const listingHeaderBlock = { padding: '8px 10px', border: '1px solid #304178', borderRadius: 10, background: '#0e1738', display: 'grid', gap: 4 };
const listingHeaderTitle = { fontWeight: 700, fontSize: 13, color: '#fff' };
const listingLink = { color: '#8fb7ff', fontSize: 12, textDecoration: 'none' };
