import React, { useEffect, useState } from 'react';
import { GAMES } from './content';

const live = (w) => `/week${w}/`;
const solo = (w) => `/solo/week${w}/`;

function PlayButtons({ g, big = false }) {
  return (
    <div className={`play ${big ? 'play--big' : ''}`}>
      <a className="play__btn play__btn--solo" href={solo(g.week)} onClick={(e) => e.stopPropagation()}>
        <span className="play__icon" aria-hidden="true">▶</span>
        <span>
          Play solo
          <small>You vs a room of bots</small>
        </span>
      </a>
      <a className="play__btn play__btn--live" href={live(g.week)} onClick={(e) => e.stopPropagation()}>
        <span className="play__icon" aria-hidden="true">◉</span>
        <span>
          Play live
          <small>With the room, at a meeting</small>
        </span>
      </a>
    </div>
  );
}

function GameCard({ g, onOpen }) {
  return (
    <article
      className="gcard"
      style={{ '--c': g.color }}
      tabIndex={0}
      role="button"
      aria-label={`Week ${g.week}: ${g.title}. Open details`}
      onClick={() => onOpen(g)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(g))}
    >
      <div className="gcard__shot">
        <img src={`/images/games/week${g.week}.jpg`} alt={`Screenshot of ${g.title}`} loading="lazy" />
        <div className="gcard__veil">
          <PlayButtons g={g} />
          <span className="gcard__more">More about this game</span>
        </div>
        <span className="gcard__wk">Week {g.week}</span>
      </div>
      <div className="gcard__body">
        <p className="gcard__meeting">{g.meeting}</p>
        <h3>{g.title}</h3>
        <p>{g.hook}</p>
        <div className="gcard__tags">
          {g.topics.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </div>
      <div className="gcard__touch">
        <PlayButtons g={g} />
      </div>
    </article>
  );
}

function GameSheet({ g, onClose }) {
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
    <div className="modal modal--dark" role="dialog" aria-modal="true" aria-label={g.title} onClick={onClose}>
      <div className="sheet" style={{ '--c': g.color }} onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="sheet__shot">
          <img src={`/images/games/week${g.week}.jpg`} alt={`Screenshot of ${g.title}`} />
        </div>
        <div className="sheet__body">
          <p className="sheet__wk">
            Week {g.week} · {g.meeting}
          </p>
          <h2>{g.title}</h2>
          <p className="sheet__hook">{g.hook}</p>
          <p>{g.blurb}</p>
          <div className="gcard__tags">
            {g.topics.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <PlayButtons g={g} big />
          <p className="sheet__note">
            <b>Solo</b> runs entirely in your browser: the real game, with bot teams in place of the room. You can bring a friend onto your team on the same screen.{' '}
            <b>Live</b> is the meeting version. It needs a host to open a round.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Games() {
  const [open, setOpen] = useState(null);
  return (
    <main className="games">
      <section className="games__hero">
        <div className="container">
          <p className="eyebrow">Games</p>
          <h1>Six weeks, six trading games.</h1>
          <p className="games__lede">
            Each one was built for a meeting, around one idea. Play live with the room, or solo against bot traders who have their own private information. Some of the
            bots are sharp; others are there to be picked off.
          </p>
        </div>
      </section>
      <section className="container games__grid">
        {GAMES.map((g) => (
          <GameCard key={g.week} g={g} onOpen={setOpen} />
        ))}
      </section>
      {open && <GameSheet g={open} onClose={() => setOpen(null)} />}
    </main>
  );
}
