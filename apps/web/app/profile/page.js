'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState('');
  const [handle, setHandle] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    async function init() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      setUser(u || null);
      if (!u) return;
      const { data: profile } = await supabase.from('profiles').select('full_name,handle').eq('id', u.id).single();
      if (profile) {
        setFullName(profile.full_name || '');
        setHandle(profile.handle || '');
      }
    }
    init();
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    if (!supabase || !user) return setMsg('Please log in first.');

    let avatarUrl = null;
    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const upload = await supabase.storage.from('profile-photos').upload(path, avatarFile, { upsert: true });
      if (upload.error) return setMsg(upload.error.message);
      const { data: pub } = supabase.storage.from('profile-photos').getPublicUrl(path);
      avatarUrl = pub.publicUrl;
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      handle,
      avatar_url: avatarUrl,
    });

    setMsg(error ? error.message : 'Profile saved.');
  }

  return (
    <main style={wrap}>
      <form onSubmit={saveProfile} style={card}>
        <h1>Profile</h1>
        <input style={input} placeholder='Display name' value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input style={input} placeholder='Handle' value={handle} onChange={(e) => setHandle(e.target.value)} />
        <input style={input} type='file' accept='image/*' onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
        <button style={btn} type='submit'>Save Profile</button>
        {msg ? <p>{msg}</p> : null}
        <a href='/' style={{ color: '#8fb7ff' }}>Back home</a>
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 500, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
