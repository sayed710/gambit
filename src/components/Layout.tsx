import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useSettings } from '../state/SettingsContext';
import { GearIcon, KnightMark, MenuIcon, MoonIcon, SunIcon, XIcon } from './Icons';
import { playSound } from '../lib/sound';

function ThemeToggle() {
  const { resolvedTheme, set } = useSettings();
  const dark = resolvedTheme === 'dark';
  return (
    <button
      className="icon-btn"
      onClick={() => {
        set('theme', dark ? 'light' : 'dark');
        playSound('click');
      }}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

const BOARD_SWATCHES: { id: 'walnut' | 'forest' | 'slate' | 'ink'; label: string; light: string; dark: string }[] = [
  { id: 'walnut', label: 'Walnut', light: '#efe3cb', dark: '#9a6b45' },
  { id: 'forest', label: 'Forest', light: '#ecead4', dark: '#6f8f57' },
  { id: 'slate', label: 'Slate', light: '#d9dcdf', dark: '#5c6773' },
  { id: 'ink', label: 'Ink', light: '#c9c4b4', dark: '#4f4a40' },
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
            <label>Appearance</label>
            <div className="seg" role="radiogroup" aria-label="Theme">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button key={t} className={settings.theme === t ? 'on' : ''} onClick={() => settings.set('theme', t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
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

const NAV = [
  { to: '/play', label: 'Play' },
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/profile', label: 'Profile' },
];

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

  return (
    <>
      <header className="site-header">
        <div className="container inner">
          <Link to="/" className="brand" aria-label="Gambit home">
            <span className="mark">
              <KnightMark />
            </span>
            Gambit
          </Link>
          <nav className="main-nav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive || (n.to !== '/' && location.pathname.startsWith(n.to)) ? 'active' : '')}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <ThemeToggle />
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
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>
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
          <span>Gambit — a quiet place to play chess.</span>
          <span>
            Everything runs in your browser — no account, no server ·{' '}
            {new Date().getFullYear()}
          </span>
        </div>
      </footer>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

export { SettingsModal };
