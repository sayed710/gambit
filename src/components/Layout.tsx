import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useSettings } from '../state/SettingsContext';
import { GearIcon, KnightMark, MenuIcon, XIcon } from './Icons';
import { NAV_SECTIONS, sectionMatches } from '../lib/navSection';

const BOARD_SWATCHES: { id: 'glacier' | 'seaice' | 'polarnight' | 'aurora' | 'frost' | 'walnut'; label: string; light: string; dark: string }[] = [
  { id: 'glacier', label: 'Glacier', light: '#C7D9E6', dark: '#3E637F' },
  { id: 'seaice', label: 'Sea Ice', light: '#F2F7FA', dark: '#C2D8E4' },
  { id: 'polarnight', label: 'Polar Night', light: '#2E4358', dark: '#12212F' },
  { id: 'aurora', label: 'Aurora', light: '#24404A', dark: '#101E28' },
  { id: 'frost', label: 'Frost', light: '#E4EBEF', dark: '#9FB4C4' },
  { id: 'walnut', label: 'Walnut', light: '#E8D9C0', dark: '#9A6B45' },
];

function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close settings">
            <XIcon />
          </button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label htmlFor="set-name">Your name</label>
            <input
              id="set-name"
              className="input"
              value={settings.name}
              maxLength={24}
              onChange={(e) => settings.set('name', e.target.value)}
              placeholder="How you appear at the board"
            />
          </div>

          <div className="field">
            <label>Board</label>
            <div className="swatch-row">
              {BOARD_SWATCHES.map((b) => (
                <button
                  key={b.id}
                  className={`swatch${settings.boardTheme === b.id ? ' on' : ''}`}
                  onClick={() => settings.set('boardTheme', b.id)}
                  aria-label={`${b.label} board`}
                  aria-pressed={settings.boardTheme === b.id}
                >
                  <i style={{ background: b.light }} />
                  <i style={{ background: b.dark }} />
                </button>
              ))}
            </div>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={settings.soundOn} onChange={(e) => settings.set('soundOn', e.target.checked)} />
            Sound effects
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.showLegalHints}
              onChange={(e) => settings.set('showLegalHints', e.target.checked)}
            />
            Show legal-move hints when a piece is selected
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.showCoordinates}
              onChange={(e) => settings.set('showCoordinates', e.target.checked)}
            />
            Show board coordinates
          </label>
          <div className="field">
            <label>Piece animation</label>
            <div className="seg" role="radiogroup" aria-label="Animation speed">
              {(['slow', 'normal', 'fast', 'off'] as const).map((a) => (
                <button
                  key={a}
                  role="radio"
                  aria-checked={settings.animationSpeed === a}
                  className={settings.animationSpeed === a ? 'on' : ''}
                  onClick={() => settings.set('animationSpeed', a)}
                >
                  {a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.confirmResign}
              onChange={(e) => settings.set('confirmResign', e.target.checked)}
            />
            Ask before resigning
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}



export default function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const p = location.pathname;
  const page = p.startsWith('/play')
    ? 'play'
    : p.startsWith('/review')
      ? 'review'
      : p.startsWith('/editor') || p.startsWith('/studies') || p.startsWith('/analysis')
        ? 'analysis'
        : p.startsWith('/repertoire') || p.startsWith('/coordinates') || p.startsWith('/puzzles')
          ? 'puzzles'
          : p.startsWith('/library')
            ? 'library'
            : p.startsWith('/profile')
              ? 'profile'
              : 'home';

  return (
    <div data-page={page} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: '100dvh' }}>
      <header className="site-header">
        <div className="container inner">
          <Link to="/" className="brand" aria-label="Gambit home">
            <span className="mark">
              <KnightMark />
            </span>
            Gambit
          </Link>
          <nav className="main-nav" aria-label="Main">
            {NAV_SECTIONS.map((n) => (
              <NavLink key={n.to} to={n.to} className={() => (sectionMatches(n, location.pathname) ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
              <GearIcon />
            </button>
            <button
              className="icon-btn menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>
        <div className="container">
          <nav className={`mobile-nav ${menuOpen ? 'open' : ''}`} aria-label="Mobile">
            {NAV_SECTIONS.map((n) => (
              <NavLink key={n.to} to={n.to} className={() => (sectionMatches(n, location.pathname) ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="shell">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container inner">
          <span>Gambit, a quiet place to play chess.</span>
          <span>
            Everything runs in your browser, no account, no server ·{' '}
            {new Date().getFullYear()}
          </span>
        </div>
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export { SettingsModal };
