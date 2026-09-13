import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { loadJSON, saveJSON } from '../lib/storage';
import { setSoundEnabled, setSoundVolume } from '../lib/sound';

export type BoardTheme = 'glacier' | 'seaice' | 'polarnight' | 'aurora' | 'frost' | 'walnut';
export type AnimationSpeed = 'slow' | 'normal' | 'fast' | 'off';

export const ANIMATION_MS: Record<AnimationSpeed, number> = { slow: 320, normal: 180, fast: 90, off: 0 };

interface Settings {
  theme: Theme | 'system';
  volume: number;
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
  volume: 35,
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

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULTS, ...loadJSON('settings', {}) }));

  // Arctic Editorial ships as one calm dark theme; the stored preference is kept
  // for schema stability but the resolved theme is always dark.
  const resolvedTheme: Theme = 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.board = settings.boardTheme;
  }, [resolvedTheme, settings.boardTheme]);

  useEffect(() => {
    setSoundEnabled(settings.soundOn);
  }, [settings.soundOn]);

  useEffect(() => {
    setSoundVolume(settings.volume);
  }, [settings.volume]);

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
