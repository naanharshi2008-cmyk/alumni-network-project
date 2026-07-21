import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sora, Manrope } from 'next/font/google';

// next/font manages <head> injection itself (self-hosted at build time), so
// it never fights with Next's dev-overlay scripts the way a hand-written
// <link> tag in a custom <head> did - that mismatch was causing a hydration
// warning on first load.
const sora = Sora({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-sora', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  title: 'Veveaham Alumni',
  description: 'See where our seniors went and what they are doing now.',
  icons: {
    icon: 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="black"/><text x="50" y="66" font-size="58" text-anchor="middle">🎓</text></svg>'
    ),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable}`}>
      <body>
        <nav className="nav">
          <Link href="/" className="nav__brand">
            <span className="nav__logo">🎓</span>
            <span>Veveaham Alumni</span>
          </Link>
          <div className="nav__links">
            <Link href="/directory" className="nav__link">Directory</Link>
            <Link href="/login" className="nav__link">Login</Link>
            <Link href="/register" className="nav__link nav__link--cta">Register</Link>
          </div>
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
            <span className="nav__logo">🎓</span>
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
            <Link href="/register">Register</Link>
          </div>
          <div className="footer__col">
            <h4>About</h4>
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '3px 0' }}>
              Veveaham Group of Schools
            </span>
            <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.9rem', padding: '3px 0' }}>
              Alumni Network
            </span>
          </div>
        </div>
      </div>

      <div className="footer__bottom">
        <span>© {year} Veveaham Alumni. All rights reserved.</span>
        <span>Built with <span className="footer__heart">♥</span> by the alumni community.</span>
      </div>
    </footer>
  );
}
