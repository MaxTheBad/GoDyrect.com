'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setMsg('Supabase env vars are missing.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setMsg(error ? error.message : 'Logged in. Redirecting...');
    if (!error) setTimeout(() => (window.location.href = '/dashboard'), 600);
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <a href='/' style={brand}><div style={brandIcon} /><strong style={{ color: '#fff' }}>GoDyrect</strong></a>
        <h1 style={{ margin: 0 }}>Log in</h1>
        <input style={input} placeholder='Email' type='email' name='email' autoComplete='email' value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} placeholder='Password' type='password' name='password' id='login-password' autoComplete='current-password' value={password} onChange={(e) => setPassword(e.target.value)} />
        <button style={btn} type='submit'>Log in</button>
        {msg ? <p>{msg}</p> : null}
        <p style={{ marginTop: 2 }}>Don’t have an account? <a href='/signup' style={{ color: '#8fb7ff' }}>Sign up</a></p>
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1020', color: '#fff' };
const card = { width: 380, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12, border: '1px solid #2a3c78' };
const brand = { display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', marginBottom: 4 };
const brandIcon = { width: 28, height: 28, borderRadius: 8, background: '#2e7dff' };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
