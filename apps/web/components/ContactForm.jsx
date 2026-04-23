'use client'
import {useState,useEffect} from 'react'
import {useSearchParams} from 'next/navigation'

export default function ContactForm(){
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [role,setRole]=useState('')
  const [message,setMessage]=useState('')
  const [status,setStatus]=useState(null)
  const searchParams = useSearchParams()

  useEffect(()=>{
    const r = searchParams.get('role')
    if(r) setRole(r)
  },[searchParams])

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
    <form onSubmit={handleSubmit} style={{display:'flex',flexDirection:'column',gap:12,maxWidth:600}}>
      <label>Name<input value={name} onChange={e=>setName(e.target.value)} required /></label>
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
      <label>Role
        <select value={role} onChange={e=>setRole(e.target.value)}>
          <option value="">Select role</option>
          <option value="owner">Owner</option>
          <option value="buyer">Buyer</option>
          <option value="broker">Broker</option>
        </select>
      </label>
      <label>Message<textarea value={message} onChange={e=>setMessage(e.target.value)} rows={6} required /></label>
      <button type="submit">Send</button>
      {status && <p>Status: {status}</p>}
      <p style={{fontSize:12,color:'#666'}}>Note: replace the Formspree endpoint in components/ContactForm.jsx with your form ID or set up a server endpoint.</p>
    </form>
  )
}
