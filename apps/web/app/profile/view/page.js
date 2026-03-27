'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';

export default function PublicProfilePage() {
  const [id, setId] = useState('');
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const value = new URLSearchParams(window.location.search).get('id') || '';
    setId(value);
  }, []);

  useEffect(() => {
    async function load() {
      if (!supabase || !id) return;
      const { data, error } = await supabase
        .from('profiles')
        .select('id,full_name,handle,role,bio,avatar_url')
        .eq('id', id)
        .maybeSingle();
      if (error) return setMsg(error.message);
      setProfile(data || null);
    }
    load();
  }, [id]);

  if (!id) return <main style={wrap}><div style={card}><p>Missing profile id.</p></div></main>;
  if (!profile) return <main style={wrap}><div style={card}><p>{msg || 'Loading profile...'}</p></div></main>;

  return (
    <main style={wrap}>
      <div style={card}>
        {profile.avatar_url ? <img src={profile.avatar_url} alt='avatar' style={avatar} /> : <div style={avatarFallback}>{initial(profile.full_name)}</div>}
        <h1 style={{ marginBottom: 4 }}>{profile.full_name || 'User'}</h1>
        {profile.handle ? <p style={{ margin: 0, opacity: 0.8 }}>@{profile.handle}</p> : null}
        {profile.role ? <span style={badge(profile.role)}>{profile.role === 'not_sure' ? 'Not sure yet' : profile.role}</span> : null}
        {profile.bio ? <p style={{ marginTop: 10 }}>{profile.bio}</p> : null}
      </div>
    </main>
  );
}

function initial(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 560, margin: '0 auto', background: '#121b3f', border: '1px solid #2a3c78', borderRadius: 12, padding: 16, display: 'grid', gap: 8 };
const avatar = { width: 96, height: 96, borderRadius: 999, objectFit: 'cover' };
const avatarFallback = { width: 96, height: 96, borderRadius: 999, display: 'grid', placeItems: 'center', background: '#243569', fontSize: 28 };
const badge = (role) => ({ display: 'inline-block', width: 'fit-content', padding: '6px 10px', borderRadius: 999, background: role === 'seller' ? '#124d2f' : role === 'buyer' ? '#1e3a8a' : '#5b4b16', border: '1px solid #3a4f8f', fontSize: 12 });
