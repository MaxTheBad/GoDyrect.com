'use client'
import Link from 'next/link'

export default function Landing() {
  return (
    <main className="hero">
      <div className="container">
        <header className="header">
          <div className="logo">G<span>o</span>Dyrect</div>
          <nav className="nav"><Link href="/about">About</Link><Link href="/contactus">Contact</Link></nav>
        </header>

        <section className="content">
          <h1 className="title">Buy, Sell, or Broker — Fast & Direct</h1>
          <p className="subtitle">GoDyrect connects owners, buyers, and brokers with a simple marketplace to list, find, and close deals faster.</p>

          <div className="buttons">
            <Link href="/contactus?role=owner"><a className="btn primary">I'm an Owner</a></Link>
            <Link href="/contactus?role=buyer"><a className="btn outline">I'm a Buyer</a></Link>
            <Link href="/contactus?role=broker"><a className="btn ghost">I'm a Broker</a></Link>
          </div>
        </section>

        <div className="animation" aria-hidden>
          <div className="card c1"/>
          <div className="card c2"/>
          <div className="card c3"/>
        </div>

        <footer className="foot">© {new Date().getFullYear()} GoDyrect</footer>
      </div>

      <style jsx>{`
        .hero{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0f172a 0%,#0b1220 50%,#071129 100%);color:#e6eef8;padding:48px;}
        .container{width:100%;max-width:1100px;position:relative}
        .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem}
        .logo{font-weight:800;font-size:1.25rem;letter-spacing:0.5px}
        .logo span{color:#7dd3fc}
        .nav a{color:rgba(230,238,248,0.9);margin-left:1rem;text-decoration:none}

        .content{background:linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01));padding:48px;border-radius:16px;box-shadow:0 10px 30px rgba(2,6,23,0.6);backdrop-filter:blur(6px)}
        .title{font-size:2.25rem;margin:0 0 12px}
        .subtitle{margin:0 0 20px;color:rgba(230,238,248,0.8);max-width:680px}

        .buttons{display:flex;gap:12px;flex-wrap:wrap}
        .btn{padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;display:inline-block;transition:transform .18s ease,box-shadow .18s ease}
        .btn.primary{background:linear-gradient(90deg,#06b6d4,#06b6b8);color:#021025;box-shadow:0 8px 20px rgba(6,182,212,0.12)}
        .btn.primary:hover{transform:translateY(-4px);box-shadow:0 16px 30px rgba(6,182,212,0.18)}
        .btn.outline{background:transparent;border:1px solid rgba(230,238,248,0.12);color:#e6eef8}
        .btn.outline:hover{transform:translateY(-3px);box-shadow:0 10px 24px rgba(14,30,52,0.4)}
        .btn.ghost{background:rgba(255,255,255,0.03);color:#a8d5ef}

        .animation{position:absolute;right:-40px;top:40px;width:320px;height:320px;pointer-events:none}
        .card{position:absolute;width:160px;height:100px;border-radius:14px;filter:blur(0.6px);opacity:0.95}
        .c1{background:linear-gradient(135deg,rgba(125,211,252,0.14),rgba(6,182,212,0.08));top:0;left:20px;transform:rotate(-8deg);animation:float 6s ease-in-out infinite}
        .c2{background:linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.06));top:90px;left:80px;transform:rotate(6deg);animation:float 5s ease-in-out .3s infinite}
        .c3{background:linear-gradient(135deg,rgba(16,185,129,0.12),rgba(34,197,94,0.06));top:160px;left:10px;transform:rotate(-4deg);animation:float 7s ease-in-out .6s infinite}

        @keyframes float{0%{transform:translateY(0) rotate(var(--r))}50%{transform:translateY(-14px) rotate(calc(var(--r) + 2deg))}100%{transform:translateY(0) rotate(var(--r))}}

        .foot{margin-top:20px;color:rgba(230,238,248,0.6);font-size:0.9rem}

        @media (max-width:880px){
          .animation{display:none}
          .content{padding:28px}
          .title{font-size:1.6rem}
        }
      `}</style>
    </main>
  )
}
