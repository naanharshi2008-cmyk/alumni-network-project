import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Sora, Manrope } from 'next/font/google';
import Crest from '../lib/Crest';
import { siteOrigin } from '../lib/site';
import { SCHOOL_GROUP_NAME } from '../lib/types';
import NavAuth from './NavAuth';
import ViewerProvider from './Viewer';
import FooterNetworkLinks from './FooterNetworkLinks';

// next/font manages <head> injection itself (self-hosted at build time), so
// it never fights with Next's dev-overlay scripts the way a hand-written
// <link> tag in a custom <head> did - that mismatch was causing a hydration
// warning on first load.
const sora = Sora({ subsets: ['latin'], weight: ['500', '600', '700', '800'], variable: '--font-sora', display: 'swap' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  // Everything below this line may use relative URLs - canonicals, Open Graph
  // images, the sitemap - and Next resolves them against this. It is the one
  // place the site's address is decided, which is what makes moving to the
  // school's own domain a single change.
  metadataBase: new URL(siteOrigin()),
  title: { default: 'Veveaham Alumni', template: '%s · Veveaham Alumni' },
  description: 'See where our seniors went and what they are doing now.',
  // Favicon and home-screen icon come from app/icon.png and app/apple-icon.png
  // (Next's file convention), both cut from the school crest.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${manrope.variable}`}>
      <body>
        {/* First thing a keyboard reaches. Without it, every page load meant
            tabbing past the nav and, on the directory, a search box and eight
            more controls before the first card. */}
        <a href="#main" className="skip-link">Skip to content</a>
        <ViewerProvider>
          {/* The sticky lives on the header, not the nav inside it: a sticky
              element needs a containing block taller than itself, and once the
              nav is wrapped its containing block is exactly its own height. */}
          <header className="site-header">
            <nav className="nav" aria-label="Main">
              <Link href="/" className="nav__brand">
                <Crest />
                <span>Veveaham Alumni</span>
              </Link>
              <NavAuth />
            </nav>
          </header>
          {/* One <main> for the whole site. Seven pages had their own and five
              had none at all. tabIndex is what makes the skip link move focus
              rather than only scrolling. */}
          <main id="main" className="site-main" tabIndex={-1}>{children}</main>
          <Footer />
        </ViewerProvider>
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
            A living record of every senior from {SCHOOL_GROUP_NAME}, where
            they studied, and what they went on to build.
          </p>
        </div>

        <div className="footer__links">
          <div className="footer__col">
            <h2 className="footer__col-title">Explore</h2>
            <Link href="/">Home</Link>
            <Link href="/directory">Directory</Link>
            <Link href="/colleges">Colleges</Link>
          </div>
          <div className="footer__col">
            <h2 className="footer__col-title">Network</h2>
            <FooterNetworkLinks />
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
