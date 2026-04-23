import ContactForm from '../../components/ContactForm'
import Link from 'next/link'

export default function ContactPage(){
  return (
    <main className="hero">
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

          <p style={{marginTop:20}}>Or <Link href="/landing">return to landing</Link>.</p>
        </section>

        <footer className="foot">© {new Date().getFullYear()} GoDyrect</footer>
      </div>

      <style jsx>{`
        .hero{min-height:80vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a 0%,#0b1220 50%,#071129 100%);color:#e6eef8;padding:48px;}
        .container{width:100%;max-width:900px;position:relative}
        .header{display:flex;justify-content:flex-start;align-items:center;margin-bottom:2rem}
        .logo{font-weight:800;font-size:1.25rem;letter-spacing:0.5px}
        .logo span{color:#7dd3fc}

        .content{background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));padding:36px;border-radius:12px;box-shadow:0 10px 30px rgba(2,6,23,0.6);backdrop-filter:blur(6px)}
        .title{font-size:1.75rem;margin:0 0 8px}
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
