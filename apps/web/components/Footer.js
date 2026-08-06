export default function Footer(){
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">© {new Date().getFullYear()} GoDyrect. Deals move better direct.</div>
        <nav className="site-footer__links" aria-label="Footer navigation">
          <a href="/about">About</a>
          <a href="/contactus">Contact</a>
          <a href="/legal/privacy">Privacy</a>
        </nav>
      </div>
    </footer>
  )
}
