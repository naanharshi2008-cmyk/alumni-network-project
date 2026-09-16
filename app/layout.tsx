import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sora, Manrope } from 'next/font/google';
import Crest from '../lib/Crest';
import NavAuth from './NavAuth';

// next/font manages <head> injection itself (self-hosted at build time), so
// it never fights with Next's dev-overlay scripts the way a hand-written
// <link> tag in a custom <head> did - that mismatch was causing a hydration
// warning on first load.
const sora = Sora({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-sora', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: 'Veveaham Alumni',
  description: 'See where our seniors went and what they are doing now.',
  // Favicon and home-screen icon come from app/icon.png and app/apple-icon.png
  // (Next's file convention), both cut from the school crest.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable}`}>
      <body>
        <nav className="nav">
          <Link href="/" className="nav__brand">
            <Crest />
            <span>Veveaham Alumni</span>
          </Link>
          <NavAuth />
        </nav>
        {children}
        <Footer />
      </body>
    </html>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div>
          <div className="footer__brand">
            <Crest />
            <span>Veveaham Alumni</span>
          </div>
          <p className="footer__tag">
            A living record of every senior from Veveaham group of Schools, where
            they studied, and what they went on to build.
          </p>
        </div>

        <div className="footer__links">
          <div className="footer__col">
            <h4>Explore</h4>
            <Link href="/">Home</Link>
            <Link href="/directory">Directory</Link>
            <Link href="/colleges">Colleges</Link>
          </div>
          <div className="footer__col">
            <h4>Network</h4>
            <Link href="/about">About</Link>
            <Link href="/register">Add your journey</Link>
            <Link href="/login">Sign in</Link>
          </div>
        </div>
      </div>

      <div className="footer__bottom">
        <span>© {year} Veveaham Alumni. All rights reserved.</span>

        <div className="footer__credits">
          <span className="footer__special">
            concept by Elancheran R S • UI/UX Design by Vaibhavsawroop
          </span>

          <span className="footer__built">
            Built with <span className="footer__heart">♥</span> by the alumni community.
          </span>
        </div>
      </div>
    </footer>
  );
}
