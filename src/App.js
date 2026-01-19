import React, { useState, useEffect, useMemo } from 'react';
import './App.css';

function App() {
  const [activeNav, setActiveNav] = useState('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [typewriterText, setTypewriterText] = useState('');
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [selectedLeader, setSelectedLeader] = useState(null);
  
  const typewriterLines = useMemo(() => [
    "Discovering Econometrics:",
    "Learning Through Application"
  ], []);

  // Typewriter effect
  useEffect(() => {
    if (currentLineIndex >= typewriterLines.length) return;
    
    const currentLine = typewriterLines[currentLineIndex];
    if (typewriterText.length < currentLine.length) {
      const timeout = setTimeout(() => {
        setTypewriterText(currentLine.slice(0, typewriterText.length + 1));
      }, 40);
      return () => clearTimeout(timeout);
    } else if (currentLineIndex < typewriterLines.length - 1) {
      const timeout = setTimeout(() => {
        setTypewriterText('');
        setCurrentLineIndex(currentLineIndex + 1);
      }, 500);
      return () => clearTimeout(timeout);
    }
  }, [typewriterText, currentLineIndex, typewriterLines]);

  useEffect(() => {
    const handleScroll = () => {
      const sections = ['home', 'about', 'leadership'];
      const scrollPosition = window.scrollY + 100;

      for (const section of sections) {
        const element = document.getElementById(section);
        if (element) {
          const offsetTop = element.offsetTop;
          const offsetBottom = offsetTop + element.offsetHeight;
          if (scrollPosition >= offsetTop && scrollPosition < offsetBottom) {
            setActiveNav(section);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSection = (sectionId) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="App">
      {/* Navigation */}
      <nav className="navbar">
        <div className="nav-container">
          <div className="nav-logo" onClick={() => scrollToSection('home')}>
            <span className="delta-symbol">Δ</span>
          </div>
          
          <div className={`nav-links ${mobileMenuOpen ? 'active' : ''}`}>
            <button 
              onClick={() => scrollToSection('home')} 
              className={activeNav === 'home' ? 'active' : ''}
              style={{ background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}
            >
              Home
            </button>
            <button 
              onClick={() => scrollToSection('about')} 
              className={activeNav === 'about' ? 'active' : ''}
              style={{ background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}
            >
              About
            </button>
            <button 
              onClick={() => scrollToSection('leadership')} 
              className={activeNav === 'leadership' ? 'active' : ''}
              style={{ background: 'none', border: 'none', font: 'inherit', cursor: 'pointer' }}
            >
              Leadership
            </button>
          </div>

          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home" className="hero-section">
        <div className="hero-content">
          <h1 className="hero-title">DELTA</h1>
          <div className="typewriter-container">
            {currentLineIndex === 0 && (
              <p className="typewriter-line">
                {typewriterText}
                <span className="typewriter-cursor"></span>
              </p>
            )}
            {currentLineIndex === 1 && (
              <>
                <p className="typewriter-line">Discovering Econometrics:</p>
                <p className="typewriter-line">
                  {typewriterText}
                  <span className="typewriter-cursor"></span>
                </p>
              </>
            )}
          </div>
          <div className="scroll-arrow" onClick={() => scrollToSection('about')}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7"/>
            </svg>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="about-section">
        <div className="container">
          <h2 className="section-title">About Us</h2>
          
          <div className="about-content">
            <div className="about-image">
              <img src="/images/group-photo.png" alt="DELTA Club" className="about-photo-img" />
            </div>
            <div className="about-text">
              <p className="about-description">
                DELTA is a collaborative, student-led organization at the University of Notre Dame 
                dedicated to exploring the intersection of mathematics, theory, and real-world application.
              </p>
              <p className="about-description">
                Each week, members dive into topics ranging from econometric modeling and optimization 
                to probability and quantitative finance, learning how abstract mathematical ideas shape 
                the world around us.
              </p>
              
              <div className="weekly-meetings">
                <h3>Weekly Meetings</h3>
                <p className="meeting-time">Every Monday at 7:00 PM (DeBart 126)</p>
                <p className="meeting-description">Join us for interactive discussions, presentations, and collaborative problem-solving.</p>
              </div>
              
              <p className="contact-info">
                Contact us at <a href="mailto:ggardey@nd.edu" className="email-link">ggardey@nd.edu</a>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Trading Competition Section */}
      <section className="competition-section">
        <div className="container">
          <h2 className="section-title">The Notre Dame Trading Competition</h2>
          <p className="competition-subtitle">Hosted by Notre Dame DELTA Club</p>
          
          <div className="competition-layout">
            <div className="competition-left">
              <div className="competition-image">
                <img src="/images/trading_room.jpg" alt="Mendoza Trading Room" className="competition-photo-img" />
              </div>
            </div>
            
            <div className="competition-right">
              <p className="competition-description">
                The Notre Dame Trading Competition, in partnership with NDIGI, invites teams to build 
                a high-frequency trading algorithm, connect to a simulated financial exchange, and compete 
                live in the Mendoza Trading Room. It's a great opportunity to learn how markets work in 
                real time, try out quantitative finance strategies, and compete for cash prizes.
              </p>
              <p className="competition-description">
                You'll also have the chance to meet and network with quantitative traders and professionals 
                in the industry. No prior experience is required, and all majors are welcome. Food will be provided.
              </p>
            </div>
          </div>
          
          <div className="competition-footer">
            <div className="competition-info-row">
              <div className="info-item-inline">
                <strong>Date:</strong> Saturday, December 6
              </div>
              <div className="info-item-inline">
                <strong>Time:</strong> 1:30–5:30 PM
              </div>
              <div className="info-item-inline">
                <strong>Location:</strong> Mendoza Trading Room
              </div>
            </div>
            <a href="https://forms.gle/bZ7e9GAtJd1phjCu8" className="cta-button-large" target="_blank" rel="noopener noreferrer">
              Register Now
            </a>
          </div>
        </div>
      </section>

      {/* Leadership Section */}
      <section id="leadership" className="leadership-section">
        <div className="container">
          <h2 className="section-title">Leadership</h2>
          <p className="leadership-year">2025 - 2026</p>

          <div className="leaders-grid">
            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'George Gardey',
              role: 'Co-President',
              email: 'ggardey@nd.edu',
              bio: 'George Gardey is a junior double majoring in computer science and economics. He previously interned at Amazon and will be joining Optiver in Chicago next summer.',
              linkedin: 'https://www.linkedin.com/in/georgegardey/',
              initial: 'G',
              photo: '/images/george.jpeg'
            })}>
              <div className="leader-image">
                <img src="/images/george.jpeg" alt="George Gardey" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>George Gardey</h3>
                <p className="role">Co-President</p>
              </div>
            </div>

            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'Calvin Bacall',
              role: 'Co-President',
              email: 'cbacall@nd.edu',
              bio: 'Calvin Bacall is a junior double majoring in physics and economics. Last summer he conducted research in Theology, and he currently works as the mailman at St. Edward\'s Hall.',
              linkedin: 'https://www.linkedin.com/in/calvinbacall/',
              initial: 'C',
              photo: '/images/calvin.jpg'
            })}>
              <div className="leader-image">
                <img src="/images/calvin.jpg" alt="Calvin Bacall" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>Calvin Bacall</h3>
                <p className="role">Co-President</p>
              </div>
            </div>

            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'Nathan Gafney',
              role: 'Trading Competition Lead',
              email: 'ngafney@nd.edu',
              bio: 'Nathan Gafney is a junior double majoring in finance and applied mathematics. He previously interned at AfterQuery, a Y-Combinator backed AI research lab, and will be joining Garda Capital Partners as a trading analyst intern in New York next summer.',
              linkedin: 'https://www.linkedin.com/in/nathangafney/',
              initial: 'N',
              photo: '/images/nathan.jpg'
            })}>
              <div className="leader-image">
                <img src="/images/nathan.jpg" alt="Nathan Gafney" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>Nathan Gafney</h3>
                <p className="role">Trading Competition Lead</p>
              </div>
            </div>

            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'Ava Maria Geremia',
              role: 'Head of Marketing',
              email: 'ageremia@nd.edu',
              bio: 'Ava is a junior majoring in marketing and strategic management. She previously interned at Symbotic as a supply chain intern and will be joining Goldman Sachs next summer.',
              linkedin: 'https://www.linkedin.com/in/ava-maria-geremia/',
              initial: 'A',
              photo: '/images/ava.jpeg'
            })}>
              <div className="leader-image">
                <img src="/images/ava.jpeg" alt="Ava" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>Ava Maria Geremia</h3>
                <p className="role">Head of Marketing</p>
              </div>
            </div>

            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'Keane Gan',
              role: 'Head of Recruiting',
              email: 'kgan@nd.edu',
              bio: 'Keane Gan is a sophomore double majoring in applied mathematics and chemical engineering. He is active in SIBC finance and consulting, and previously worked as a Transport Officer for the Ministry of Defence of Singapore.',
              linkedin: 'https://www.linkedin.com/in/keanegan/',
              initial: 'K',
              photo: '/images/keane.jpeg'
            })}>
              <div className="leader-image">
                <img src="/images/keane.jpeg" alt="Keane Gan" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>Keane Gan</h3>
                <p className="role">Head of Recruiting</p>
              </div>
            </div>

            <div className="leader-card" onClick={() => setSelectedLeader({
              name: 'Amir Tomashpayev',
              role: 'Head of Research',
              email: 'atomashp@nd.edu',
              bio: 'Amir Tomashpayev is a freshman majoring in Physics and Honors Mathematics. He conducts research under Prof. Laura Fields, focusing on statistical unfolding techniques for reconstructing true neutrino interaction data, and is currently a travel team member on the Amazon SIBC project.',
              linkedin: 'https://www.linkedin.com/in/amirtomashpayev/',
              initial: 'A',
              photo: '/images/amir.jpeg'
            })}>
              <div className="leader-image">
                <img src="/images/amir.jpeg" alt="Amir Tomashpayev" className="leader-photo-img" style={{ width: '180px', height: '180px', objectFit: 'cover' }} />
              </div>
              <div className="leader-info">
                <h3>Amir Tomashpayev</h3>
                <p className="role">Head of Research</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Club Placements Section */}
      <section id="placements" className="placements-section">
        <div className="container">
          <h2 className="section-title">Club Placements</h2>
          
          <div className="placements-grid">
            <div className="placement-logo-card">
              <img src="/images/logo1.png" alt="Company 1" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo2.png" alt="Company 2" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo3.png" alt="Company 3" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo4.png" alt="Company 4" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo5.png" alt="Company 5" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo6.png" alt="Company 6" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo7.png" alt="Company 7" className="placement-logo" />
            </div>
            <div className="placement-logo-card">
              <img src="/images/logo8.png" alt="Company 8" className="placement-logo" />
            </div>
          </div>
        </div>
      </section>

      {/* Leader Modal */}
      {selectedLeader && (
        <div className="modal-overlay" onClick={() => setSelectedLeader(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedLeader(null)}>&times;</button>
            <div className="modal-header">
              <div className="modal-photo-container">
                {selectedLeader.photo ? (
                  <img src={selectedLeader.photo} alt={selectedLeader.name} className="modal-photo-img" />
                ) : (
                  <div className="modal-photo">{selectedLeader.initial}</div>
                )}
              </div>
              <div>
                <h2>{selectedLeader.name}</h2>
                <p className="modal-role">{selectedLeader.role}</p>
              </div>
            </div>
            <p className="modal-bio">{selectedLeader.bio}</p>
            <div className="modal-links">
              <a href={`mailto:${selectedLeader.email}`} className="modal-link">
                <span>📧</span> {selectedLeader.email}
              </a>
              <a href={selectedLeader.linkedin} target="_blank" rel="noopener noreferrer" className="modal-link">
                <img src="/images/linkedin_icon.png" alt="LinkedIn" className="linkedin-icon" /> LinkedIn Profile
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <div className="container">
          <p>&copy; 2025 DELTA - University of Notre Dame</p>
          <p className="footer-tagline">Bridging theory and application, one equation at a time.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
