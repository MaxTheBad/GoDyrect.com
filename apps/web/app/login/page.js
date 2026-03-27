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

  return <AuthForm title='Log in' submit={submit} email={email} setEmail={setEmail} password={password} setPassword={setPassword} msg={msg} />;
}

function AuthForm({ title, submit, email, setEmail, password, setPassword, msg }) {
  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1>{title}</h1>
        <input style={input} placeholder='Email' type='email' name='email' autoComplete='email' value={email} onChange={(e) => setEmail(e.target.value)} />
        <input style={input} placeholder='Password' type='password' name='password' id='login-password' autoComplete='current-password' value={password} onChange={(e) => setPassword(e.target.value)} />
        <button style={btn} type='submit'>{title}</button>
        {msg ? <p>{msg}</p> : null}
      </form>
    </main>
  );
}

const wrap = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1020', color: '#fff' };
const card = { width: 360, display: 'grid', gap: 10, background: '#121b3f', padding: 20, borderRadius: 12 };
const input = { borderRadius: 8, border: '1px solid #304178', background: '#0b1431', color: '#fff', padding: '10px 12px' };
const btn = { border: 0, borderRadius: 8, background: '#2e7dff', color: '#fff', padding: '10px 12px' };
