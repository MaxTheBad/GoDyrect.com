'use client';

import AuthNav from './AuthNav';
import { usePathname } from 'next/navigation';

export default function TopNav() {
  const pathname = usePathname();
  const isLanding = ['/about', '/contactus'].includes(pathname);

  return (
    <header className="site-nav">
      <div className="site-nav__inner">
        <a href='/' className="site-nav__brand" aria-label="GoDyrect home">
          <img src="/logo.png" alt="GoDyrect" />
        </a>
        {isLanding ? (
          <nav className="site-nav__links" aria-label="Main navigation">
            <a href='/explore' className="site-nav__link">Explore</a>
            <a href='/about' className="site-nav__link">About</a>
            <a href='/contactus' className="site-nav__link">Contact</a>
            <a href='/login' className="site-nav__link">Sign in</a>
            <a href='/signup' className="site-nav__cta">Join GoDyrect</a>
          </nav>
        ) : (
          <AuthNav />
        )}
      </div>
    </header>
  );
}
