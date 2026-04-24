'use client'
import ContactForm from '../../components/ContactForm'
import Link from 'next/link'

'use client'
import { useEffect, useRef } from 'react'

export default function ContactPage(){
  const ref = useRef(null)

  useEffect(()=>{
    const el = ref.current
    if(!el) return
    function onScroll(){
      const rect = el.getBoundingClientRect()
      const offset = -rect.top * 0.12
      el.style.backgroundPosition = `center calc(50% + ${offset}px)`
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return ()=> window.removeEventListener('scroll', onScroll)
  },[])

  return (
    <main ref={ref} className="hero">
      <div className="container">
        <header className="header">
          <div className="logo">G<span>o</span>Dyrect</div>
        </header>

        <section className="content">
          <h1 className="title">Contact Us</h1>
          <p className="subtitle">Fill out the form and we'll get back to you.</p>

          <div className="formWrap">
            <ContactForm />
          </div>

          <p style={{marginTop:20, color: '#ffffff'}}>Or <Link href="/landing">return to landing</Link>.</p>
        </section>

        <footer className="foot">© {new Date().getFullYear()} GoDyrect</footer>
      </div>

      <style jsx>{`
        .hero{min-height:80vh;display:flex;align-items:center;justify-content:center;background: linear-gradient(rgba(0,0,0,0.12), rgba(0,0,0,0.12)), url('/bg.jpg');background-size:cover;background-position:center;background-attachment:fixed;color:#0f172a;padding:48px;}
        .container{width:100%;max-width:900px;position:relative}
        .header{display:flex;justify-content:flex-start;align-items:center;margin-bottom:2rem}
        .logo{font-weight:800;font-size:1.25rem;letter-spacing:0.5px}
        .logo span{color:#06b6d4}

        .content{background:linear-gradient(180deg, rgba(7,10,14,0.88), rgba(8,12,20,0.82));padding:36px;border-radius:12px;box-shadow:0 10px 30px rgba(7,10,14,0.32);color:#e6eef8}
        .title{font-size:1.75rem;margin:0 0 8px;color:#e6eef8}
        .subtitle{margin:0 0 18px;color:rgba(230,238,248,0.8);max-width:680px}

        .formWrap{margin-top:12px}
        .foot{margin-top:20px;color:rgba(230,238,248,0.6);font-size:0.9rem}

        @media (max-width:880px){
          .content{padding:20px}
          .title{font-size:1.25rem}
        }
      `}</style>
    </main>
  )
}
