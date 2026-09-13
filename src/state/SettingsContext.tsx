import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { loadJSON, saveJSON } from '../lib/storage';
import { setSoundEnabled } from '../lib/sound';

export type BoardTheme = 'glacier' | 'seaice' | 'polarnight' | 'aurora' | 'frost' | 'walnut';
export type AnimationSpeed = 'slow' | 'normal' | 'fast' | 'off';

export const ANIMATION_MS: Record<AnimationSpeed, number> = { slow: 320, normal: 180, fast: 90, off: 0 };

interface Settings {
  theme: Theme | 'system';
  boardTheme: BoardTheme;
  soundOn: boolean;
  showLegalHints: boolean;
  confirmResign: boolean;
  showCoordinates: boolean;
  animationSpeed: AnimationSpeed;
  name: string;
}

const DEFAULTS: Settings = {
  theme: 'system',
  boardTheme: 'glacier',
  soundOn: true,
  showLegalHints: true,
  confirmResign: true,
  showCoordinates: true,
  animationSpeed: 'normal',
  name: 'You',
};

interface SettingsContextValue extends Settings {
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resolvedTheme: Theme;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS, ...loadJSON('settings', {}) }));
  const [sysTheme, setSysTheme] = useState<Theme>(() => systemTheme());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSysTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: Theme = settings.theme === 'system' ? sysTheme : settings.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.board = settings.boardTheme;
  }, [resolvedTheme, settings.boardTheme]);

  useEffect(() => {
    setSoundEnabled(settings.soundOn);
  }, [settings.soundOn]);

  useEffect(() => {
    saveJSON('settings', settings);
  }, [settings]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const value = useMemo(() => ({ ...settings, set, resolvedTheme }), [settings, set, resolvedTheme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const v = useContext(SettingsContext);
  if (!v) throw new Error('useSettings must be used inside SettingsProvider');
  return v;
}
