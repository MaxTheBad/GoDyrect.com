'use client'
import {useState,useEffect} from 'react'

export default function ContactForm(){
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [role,setRole]=useState('')
  const [message,setMessage]=useState('')
  const [status,setStatus]=useState(null)

  useEffect(()=>{
    try{
      const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
      const r = params.get('role')
      if(r) setRole(r)
    }catch(e){/* ignore */}
  },[])

  async function handleSubmit(e){
    e.preventDefault()
    setStatus('sending')
    try{
      // Replace the URL below with your Formspree endpoint
      const endpoint = 'https://formspree.io/f/your-form-id'
      const res = await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({name,email,role,message})
      })
      if(res.ok){
        setStatus('sent')
        setName('');setEmail('');setMessage('')
      } else {
        const data = await res.json()
        setStatus('error:'+ (data?.error || res.status))
      }
    }catch(err){
      setStatus('error')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <div className="field">
        <label className="label">Name</label>
        <input className="input" value={name} onChange={e=>setName(e.target.value)} required />
      </div>

      <div className="field">
        <label className="label">Email</label>
        <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
      </div>

      <div className="field">
        <label className="label">Role</label>
        <select className="input" value={role} onChange={e=>setRole(e.target.value)}>
          <option value="">Select role</option>
          <option value="owner">Owner</option>
          <option value="buyer">Buyer</option>
          <option value="broker">Broker</option>
        </select>
      </div>

      <div className="field">
        <label className="label">Message</label>
        <textarea className="input textarea" value={message} onChange={e=>setMessage(e.target.value)} rows={6} required />
      </div>

      <div style={{display:'flex',gap:12,alignItems:'center'}}>
        <button type="submit" className="submit">Send</button>
        {status && <p style={{margin:0}}>Status: {status}</p>}
      </div>

      <p className="note">Note: replace the Formspree endpoint in components/ContactForm.jsx with your form ID or set up a server endpoint.</p>

      <style jsx>{`
        .form{display:flex;flex-direction:column;gap:14px;max-width:680px}
        .field{display:flex;flex-direction:column;gap:8px}
        .label{font-size:14px;color:rgba(230,238,248,0.85);font-weight:700}
        .input{padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);color:#e6eef8}
        .input:focus{outline:none;box-shadow:0 6px 18px rgba(6,182,212,0.12);border-color:#06b6d4}
        .textarea{min-height:140px}
        .submit{background:#06b6d4;color:#fff;border:0;padding:10px 18px;border-radius:10px;font-weight:700;cursor:pointer}
        .submit:hover{transform:translateY(-2px)}
        .note{font-size:12px;color:rgba(230,238,248,0.7);margin:6px 0 0}
      `}</style>
    </form>
  )
}
