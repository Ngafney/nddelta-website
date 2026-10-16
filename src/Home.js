import React, { useEffect, useMemo, useState } from 'react';
import { INTEREST_FORM, CLUB_EMAIL, MEETINGS, COMPETITION, PHOTOS, LEADERS, SPONSORS, TIERS, PLACEMENTS, GAMES } from './content';

/** A logo sized by area, not height, so a wide wordmark and a square mark look the same weight. */
export function Logo({ name, logo, aspect, area = 5200, maxW = 190, maxH = 64 }) {
  let h = Math.sqrt(area / aspect);
  let w = h * aspect;
  if (w > maxW) {
    w = maxW;
    h = w / aspect;
  }
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return <img src={logo} alt={name} title={name} loading="lazy" style={{ width: Math.round(w), height: Math.round(h) }} />;
}

function Typewriter({ lines }) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (i >= lines.length) return undefined;
    if (n < lines[i].length) {
      const t = setTimeout(() => setN(n + 1), 38);
      return () => clearTimeout(t);
    }
    if (i < lines.length - 1) {
      const t = setTimeout(() => {
        setI(i + 1);
        setN(0);
      }, 380);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [i, n, lines]);
  return (
    <p className="hero__tagline" aria-label={lines.join(' ')}>
      {lines.map((l, k) => (
        <span key={k} className="hero__tagline-line" aria-hidden="true">
          {k < i ? l : k === i ? l.slice(0, n) : ''}
          {k === i && <span className="caret" />}
        </span>
      ))}
    </p>
  );
}

function Countdown() {
  const target = useMemo(() => new Date('2026-12-05T10:00:00-05:00').getTime(), []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = target - now;
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return (
    <div className="countdown" aria-label={`${days} days to go`}>
      <div>
        <strong>{days}</strong>
        <span>days</span>
      </div>
      <div>
        <strong>{hours}</strong>
        <span>hours</span>
      </div>
    </div>
  );
}

function LeaderModal({ leader, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={leader.name} onClick={onClose}>
      <div className="modal__card" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="modal__head">
          <img src={leader.photo} alt={leader.name} />
          <div>
            <h3>{leader.name}</h3>
            <p className="modal__role">{leader.role}</p>
          </div>
        </div>
        <p className="modal__bio">{leader.bio}</p>
        <div className="modal__links">
          <a href={`mailto:${leader.email}`} className="chip">
            ✉ {leader.email}
          </a>
          <a href={leader.linkedin} target="_blank" rel="noopener noreferrer" className="chip">
            <img src="/images/linkedin_icon.png" alt="" /> LinkedIn
          </a>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [leader, setLeader] = useState(null);

  // Arriving from /games with a #section: scroll once the page has laid out.
  useEffect(() => {
    if (!window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView(), 50);
  }, []);

  return (
    <main>
      {/* ── hero ─────────────────────────────────────────── */}
      <section className="hero" id="top">
        <div className="hero__bg" style={{ backgroundImage: `url(${PHOTOS.wall.src})` }} aria-hidden="true" />
        <div className="hero__shade" aria-hidden="true" />
        <div className="container hero__inner">
          <p className="eyebrow">University of Notre Dame</p>
          <h1 className="hero__title">DELTA</h1>
          <Typewriter lines={['Discovering Econometrics:', 'Learning Through Application']} />
          <p className="hero__lede">
            A student club for people who like probability, statistics and markets. Every week we take one idea and turn it into a trading game the whole room plays.
          </p>
          <div className="hero__actions">
            <a className="btn btn--gold" href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
              Join the mailing list
            </a>
            <a className="btn btn--ghost" href="/games">
              Play the games →
            </a>
          </div>
          <a className="announce" href="#competition">
            <span className="announce__dot" />
            <span>
              <b>{COMPETITION.dateShort}</b> · The Notre Dame Trading Competition is back
            </span>
            <span className="announce__arrow">→</span>
          </a>
        </div>
      </section>

      {/* ── about ────────────────────────────────────────── */}
      <section className="section section--light" id="about">
        <div className="container about">
          <div className="about__text">
            <p className="eyebrow eyebrow--dark">About</p>
            <h2>Math you can trade on.</h2>
            <p>
              DELTA is a student-run club at Notre Dame. Each meeting covers one topic from probability, statistics, econometrics or market microstructure, and then we
              play a game built around it. Teams trade against each other on a live order book, and the leaderboard goes up on the projector.
            </p>
            <p>
              So far we've traded the minimum of a hidden curve, the bias of a coin, whether an asteroid would hit Earth, a time series that might or might not mean-revert,
              and options on a sum of secret numbers. You don't need any experience, and every major is welcome. Bring a laptop.
            </p>
            <div className="meet">
              <div className="meet__row">
                <div>
                  <span className="meet__label">Weekly meetings</span>
                  <strong>{MEETINGS.when}</strong>
                  <span>{MEETINGS.where}</span>
                </div>
                <a className="btn btn--navy" href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
                  Get meeting emails
                </a>
              </div>
              <p className="meet__foot">
                Questions? <a href={`mailto:${CLUB_EMAIL}`}>{CLUB_EMAIL}</a>
              </p>
            </div>
          </div>
          <figure className="about__photo">
            <div className="about__stack">
              <img className="about__main" src={PHOTOS.firstMeeting.src} alt={PHOTOS.firstMeeting.alt} loading="lazy" />
              <img className="about__inset" src={PHOTOS.meeting.src} alt={PHOTOS.meeting.alt} loading="lazy" />
            </div>
            <figcaption>Our first meeting of 2026–27. Inset: a meeting, mid-game.</figcaption>
          </figure>
        </div>

        <div className="container pillars">
          <div className="pillar">
            <span className="pillar__num">01</span>
            <h3>A new game every week</h3>
            <p>Order books, private information and a scoreboard. You learn the idea by trading it.</p>
          </div>
          <div className="pillar">
            <span className="pillar__num">02</span>
            <h3>The trading competition</h3>
            <p>In December, teams build trading algorithms and run them against each other on a live exchange.</p>
          </div>
          <div className="pillar">
            <span className="pillar__num">03</span>
            <h3>People in the industry</h3>
            <p>Recruiting advice from members who've interned at trading firms and banks, and the firms themselves at the competition.</p>
          </div>
        </div>
      </section>

      {/* ── competition ──────────────────────────────────── */}
      <section className="section section--navy" id="competition">
        <div className="container">
          <div className="comp__head">
            <div>
              <p className="eyebrow">{COMPETITION.dateLong}</p>
              <h2>The Notre Dame Trading Competition</h2>
              <p className="comp__sub">The second one. Bigger and better than ever.</p>
            </div>
            <Countdown />
          </div>

          <div className="comp__grid">
            <div className="comp__copy">
              <p>
                Teams write trading algorithms in Python, connect them to a simulated exchange, and compete live over several short rounds. There are four assets,
                including an ETF built from a basket of the others, and you trade against other teams, market-making bots and noise traders. ETF arbitrage, market
                making, momentum and mean reversion all work if you get them right, and fees, position limits and a fast order book punish you if you don't.
              </p>
              <p>
                The first competition was held in the Mendoza Trading Room in December 2025. This year it runs all day, across Stayer Hall and the trading room. It's
                hosted by DELTA with the Notre Dame Institute for Global Investing. No experience is required, all majors are welcome, and food is provided. There are
                cash prizes, and people from the sponsoring firms will be there.
              </p>
              <dl className="facts">
                <div>
                  <dt>Date</dt>
                  <dd>{COMPETITION.dateLong}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{COMPETITION.time}</dd>
                </div>
                <div>
                  <dt>Where</dt>
                  <dd>{COMPETITION.where}</dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>Teams · Python · live exchange</dd>
                </div>
              </dl>
              <div className="comp__actions">
                <a className="btn btn--gold" href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
                  Get registration updates
                </a>
                <a className="btn btn--ghost" href="#sponsors">
                  Sponsor the competition
                </a>
              </div>
            </div>

            <div className="gallery">
              <figure className="gallery__a">
                <img src={PHOTOS.floor.src} alt={PHOTOS.floor.alt} loading="lazy" />
              </figure>
              <figure className="gallery__b">
                <img src={PHOTOS.wall.src} alt={PHOTOS.wall.alt} loading="lazy" />
              </figure>
              <figure className="gallery__c">
                <img src={PHOTOS.organizers.src} alt={PHOTOS.organizers.alt} loading="lazy" />
              </figure>
              <figure className="gallery__d">
                <img src={PHOTOS.board.src} alt={PHOTOS.board.alt} loading="lazy" />
              </figure>
              <p className="gallery__cap">From the 2025 competition.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── sponsors ─────────────────────────────────────── */}
      <section className="section section--light" id="sponsors">
        <div className="container">
          <p className="eyebrow eyebrow--dark">Sponsors</p>
          <h2>Thank you to our 2025 sponsors</h2>
          <p className="section__lede">The first Notre Dame Trading Competition happened because these firms backed it.</p>
          <div className="logo-wall logo-wall--sponsors">
            {SPONSORS.map((s) => (
              <div className="logo-card" key={s.name}>
                <Logo {...s} />
              </div>
            ))}
          </div>

          <div className="sponsor-pitch">
            <div className="sponsor-pitch__copy">
              <h3>Sponsor the 2026 competition</h3>
              <p>
                More than 100 students who are serious about markets and programming, in one room for a day, building and running trading systems. Sponsorship pays for
                prizes, infrastructure and the event itself, and we're happy to shape the benefits around your recruiting goals. Swag and recruiting resources help too.
              </p>
              <div className="sponsor-pitch__actions">
                <a className="btn btn--navy" href={`mailto:${COMPETITION.contacts.join(',')}?subject=Sponsoring%20the%202026%20Notre%20Dame%20Trading%20Competition`}>
                  Email the organizers
                </a>
                <a className="btn btn--line" href={COMPETITION.prospectus} target="_blank" rel="noopener noreferrer">
                  Sponsorship prospectus (PDF)
                </a>
              </div>
              <p className="sponsor-pitch__mails">{COMPETITION.contacts.join(' · ')}</p>
            </div>
            <div className="tiers">
              {TIERS.map((t) => (
                <div className={`tier tier--${t.name.toLowerCase()}`} key={t.name}>
                  <div className="tier__head">
                    <span>{t.name}</span>
                    <strong>{t.price}</strong>
                  </div>
                  <ul>
                    {t.perks.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── games teaser ─────────────────────────────────── */}
      <section className="section section--ink" id="games">
        <div className="container games-teaser">
          <div className="games-teaser__copy">
            <p className="eyebrow">Games</p>
            <h2>Missed a meeting? Play it anyway.</h2>
            <p>
              Every game from this semester is online. Play live with the room at a meeting, or on your own against a room of bot traders. Some of them are good, and
              some of them are there to be picked off.
            </p>
            <a className="btn btn--gold" href="/games">
              See all six games →
            </a>
          </div>
          <div className="games-teaser__chips">
            {GAMES.map((g) => (
              <a key={g.week} className="gchip" href="/games" style={{ '--c': g.color }}>
                <span className="gchip__wk">Week {g.week}</span>
                <span className="gchip__t">{g.title}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── leadership ───────────────────────────────────── */}
      <section className="section section--light" id="leadership">
        <div className="container">
          <p className="eyebrow eyebrow--dark">Leadership · 2026–2027</p>
          <h2>Who runs DELTA</h2>
          <div className="leaders">
            {LEADERS.map((l) => (
              <button className="leader" key={l.name} onClick={() => setLeader(l)}>
                <span className="leader__photo">
                  <img src={l.photo} alt={l.name} loading="lazy" />
                </span>
                <strong>{l.name}</strong>
                <span className="leader__role">{l.role}</span>
                <span className="leader__more">Read bio</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── placements ───────────────────────────────────── */}
      <section className="section section--white" id="placements">
        <div className="container">
          <p className="eyebrow eyebrow--dark">Where members go</p>
          <h2>Internships and full-time offers</h2>
          <div className="logo-wall logo-wall--placements">
            {PLACEMENTS.map((p) => (
              <div className="logo-card logo-card--flat" key={p.name}>
                <Logo {...p} area={4400} maxW={170} maxH={58} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── join band ────────────────────────────────────── */}
      <section className="join">
        <div className="container join__inner">
          <div>
            <h2>Come to a meeting.</h2>
            <p>
              {MEETINGS.when} in {MEETINGS.where}. Fill out the interest form and you'll get on the mailing list.
            </p>
          </div>
          <a className="btn btn--gold btn--lg" href={INTEREST_FORM} target="_blank" rel="noopener noreferrer">
            Interest form →
          </a>
        </div>
      </section>

      {leader && <LeaderModal leader={leader} onClose={() => setLeader(null)} />}
    </main>
  );
}
