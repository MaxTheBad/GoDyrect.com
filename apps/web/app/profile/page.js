'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function ProfilePage() {
  const [user, setUser] = useState(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [handle, setHandle] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('buyer');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarFile, setAvatarFile] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    async function init() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      setUser(u || null);
      if (!u) return;
      setEmail(u.email || '');
      const { data: profile } = await supabase.from('profiles').select('full_name,handle,phone,role,avatar_url').eq('id', u.id).single();
      if (profile) {
        setFullName(profile.full_name || '');
        setHandle(profile.handle || '');
        setPhone(profile.phone || '');
        setRole(profile.role || 'buyer');
        setAvatarUrl(profile.avatar_url || '');
      }
    }
    init();
  }, []);

  async function saveProfile(e) {
    e.preventDefault();
    if (!supabase || !user) return setMsg('Please log in first.');

    let nextAvatarUrl = avatarUrl || null;
    if (avatarFile) {
      const ext = avatarFile.name.split('.').pop();
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const upload = await supabase.storage.from('profile-photos').upload(path, avatarFile, { upsert: false });
      if (upload.error) return setMsg(upload.error.message);
      const { data: pub } = supabase.storage.from('profile-photos').getPublicUrl(path);
      nextAvatarUrl = pub.publicUrl;
    }

    if (email && email !== user.email) {
      const { error: emailErr } = await supabase.auth.updateUser({ email });
      if (emailErr) return setMsg(emailErr.message);
    }

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      full_name: fullName,
      handle,
      phone,
      role,
      avatar_url: nextAvatarUrl,
    });

    if (!error) setAvatarUrl(nextAvatarUrl || '');
    setMsg(error ? error.message : 'Profile saved.');
  }

  return (
    <main style={wrap}>
      <form onSubmit={saveProfile} style={card}>
        <h1>Profile</h1>
        {avatarUrl ? <img src={avatarUrl} alt='Profile' style={{ width: 84, height: 84, borderRadius: 999, objectFit: 'cover' }} /> : null}
        <div style={badge(role)}>{roleLabel(role)}</div>
        <input style={input} placeholder='Display name' value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <input style={input} type='email' placeholder='Email address' value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} placeholder='Handle' value={handle} onChange={(e) => setHandle(e.target.value)} />
        <input style={input} placeholder='Phone number' value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select style={input} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value='buyer'>Buyer</option>
          <option value='seller'>Seller</option>
          <option value='not_sure'>Not sure yet</option>
        </select>
        <input style={input} type='file' accept='image/*' onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
        <button style={btn} type='submit'>Save Profile</button>
        {msg ? <p>{msg}</p> : null}
        <a href='/dashboard' style={{ color: '#8fb7ff' }}>Back to dashboard</a>
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', padding: 24, background: '#0b1020', color: '#fff' };
const card = { maxWidth: 560, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12, border: '1px solid #2a3c78' };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
const badge = (role) => ({ display: 'inline-block', width: 'fit-content', padding: '6px 10px', borderRadius: 999, background: role === 'seller' ? '#124d2f' : role === 'buyer' ? '#1e3a8a' : '#5b4b16', border: '1px solid #3a4f8f', fontSize: 12, textTransform: 'capitalize' });
const roleLabel = (role) => role === 'not_sure' ? 'Not sure yet' : role;
