'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('buyer');
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setMsg('Supabase env vars are missing.');

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          role,
        },
      },
    });

    if (error) return setMsg(error.message);

    const userId = data?.user?.id;
    if (userId) {
      await supabase.from('profiles').upsert({
        id: userId,
        full_name: fullName,
        phone,
        role,
      });
    }

    setMsg('Account created. Please check your email to confirm your address.');
  }

  return (
    <main style={wrap}>
      <form onSubmit={submit} style={card}>
        <h1 style={{ marginBottom: 0 }}>Create your GoDyrect account</h1>
        <p style={{ marginTop: 4, opacity: 0.85 }}>Start as a buyer, seller, or choose later.</p>

        <label style={label}>Full name</label>
        <input style={input} placeholder='John Smith' value={fullName} onChange={(e) => setFullName(e.target.value)} required />

        <label style={label}>Email (confirmation required)</label>
        <input style={input} type='email' placeholder='you@email.com' value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label style={label}>Phone number</label>
        <input style={input} placeholder='+1 (555) 555-5555' value={phone} onChange={(e) => setPhone(e.target.value)} required />

        <label style={label}>I am joining as</label>
        <select style={input} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value='buyer'>Buyer</option>
          <option value='seller'>Seller</option>
          <option value='not_sure'>Not sure yet</option>
        </select>

        <label style={label}>Password</label>
        <input style={input} placeholder='Create a password' type='password' value={password} onChange={(e) => setPassword(e.target.value)} required />

        <button style={btn} type='submit'>Create Account</button>
        {msg ? <p style={{ marginBottom: 0 }}>{msg}</p> : null}
        <a href='/login' style={{ color: '#8fb7ff' }}>Already have an account? Log in</a>
      </form>
    </main>
  );
}

const wrap = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: 'radial-gradient(circle at 20% 20%, #16275f 0%, #0b1020 55%)',
  color: '#fff',
  padding: 16,
};
const card = {
  width: 'min(540px, 100%)',
  display: 'grid',
  gap: 10,
  background: '#121b3f',
  border: '1px solid #2a3c78',
  padding: 24,
  borderRadius: 14,
};
const label = { fontSize: 13, opacity: 0.85 };
const input = {
  borderRadius: 10,
  border: '1px solid #304178',
  background: '#0b1431',
  color: '#fff',
  padding: '11px 12px',
};
const btn = {
  border: 0,
  borderRadius: 10,
  background: '#2e7dff',
  color: '#fff',
  padding: '12px 12px',
  cursor: 'pointer',
  marginTop: 6,
};
