import React, { useEffect, useState } from 'react';
import './App.css';
import Home from './Home';
import Games from './Games';
import { INTEREST_FORM, CLUB_EMAIL, MEETINGS } from './content';

/**
 * Two pages, no router library: "/" and "/games". vercel.json rewrites
 * /games to index.html. The section links (About, Competition, …) are anchors
 * on the home page, so from /games they go to "/#section".
 */
function usePath() {
  const [path, setPath] = useState(() => window.location.pathname.replace(/\/+$/, '') || '/');
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname.replace(/\/+$/, '') || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

const SECTIONS = [
  ['about', 'About'],
  ['competition', 'Competition'],
  ['sponsors', 'Sponsors'],
  ['leadership', 'Leadership'],
];

export function Nav({ page }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      if (page !== 'home') return;
      const y = window.scrollY + 120;
      let cur = null;
      for (const [id] of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= y) cur = id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [page]);

  const href = (id) => (page === 'home' ? `#${id}` : `/#${id}`);

  return (
    <header className={`nav ${scrolled || page !== 'home' ? 'nav--solid' : ''} ${open ? 'nav--open' : ''}`}>
      <div className="nav__inner">
        <a className="nav__brand" href="/" aria-label="DELTA home">
          <span className="nav__mark">Δ</span>
          <span className="nav__word">DELTA</span>
        </a>
        <nav className="nav__links" aria-label="Main">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={href(id)} className={active === id ? 'is-active' : ''} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a href="/games" className={`nav__games ${page === 'games' ? 'is-active' : ''}`} onClick={() => setOpen(false)}>
            Games
          </a>
          <a className="btn btn--gold btn--sm nav__cta" href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
            Join DELTA
          </a>
        </nav>
        <button className="nav__burger" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen(!open)}>
          <span />
          <span />
          <span />
        </button>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <span className="nav__mark">Δ</span>
          <div>
            <strong>DELTA</strong>
            <p>Discovering Econometrics: Learning Through Application</p>
          </div>
        </div>
        <div className="footer__cols">
          <div>
            <h4>Meetings</h4>
            <p>{MEETINGS.when}</p>
            <p>{MEETINGS.where}</p>
          </div>
          <div>
            <h4>Get in touch</h4>
            <p>
              <a href={`mailto:${CLUB_EMAIL}`}>{CLUB_EMAIL}</a>
            </p>
            <p>
              <a href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
                Join the mailing list
              </a>
            </p>
          </div>
          <div>
            <h4>Explore</h4>
            <p>
              <a href="/games">Games</a>
            </p>
            <p>
              <a href="/#competition">Trading competition</a>
            </p>
          </div>
        </div>
      </div>
      <div className="container footer__base">© 2026 DELTA · University of Notre Dame</div>
    </footer>
  );
}

export default function App() {
  const path = usePath();
  const page = path === '/games' ? 'games' : 'home';

  useEffect(() => {
    document.title = page === 'games' ? 'Games · DELTA' : 'DELTA · Notre Dame';
  }, [page]);

  return (
    <div className="site">
      <Nav page={page} />
      {page === 'games' ? <Games /> : <Home />}
      <Footer />
    </div>
  );
}
