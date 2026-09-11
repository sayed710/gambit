interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

function svgProps(size: number, className?: string, style?: React.CSSProperties) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    style,
    'aria-hidden': true,
  };
}

export const KnightMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className} aria-hidden>
    <rect width="100" height="100" rx="18" fill="var(--ink)" />
    <path
      d="M30 78c0-6 1.5-10.5 4-15 1.8-3.2 4.4-6.6 4.4-6.6S35 55 35 49.5c0-3.6 1.6-6.9 4.4-9.3C41 33.8 44 27 50 22c-1 5 1 8.5 4 11 4 3.5 10 5.6 14 11 3.7 5 5.6 11.2 4.6 18-.7 4.8-3 8.6-5.6 11.6 0 0 3.4 2.4 5 6.4 1.3 3.2 1 6 1 6H30z"
      fill="var(--board-light, #EFE3CB)"
    />
    <path
      d="M50 22c-1.2 3.4-.6 6.4 1 9l11 7.4c1.8 2.6 3 5.6 3.4 9L70 74l2 12h8c0 0 .3-2.8-1-6-1.6-4-5-6.4-5-6.4 2.6-3 4.9-6.8 5.6-11.6 1-6.8-.9-13-4.6-18-4-5.4-10-7.5-14-11-3-2.5-5-6-4-11z"
      fill="var(--board-dark, #B08A54)"
    />
  </svg>
);

export const SunIcon = ({ size = 18, className, style }: IconProps) => (
  <svg {...svgProps(size, className, style)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const MoonIcon = ({ size = 18, className, style }: IconProps) => (
  <svg {...svgProps(size, className, style)}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export const GearIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const FlagIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

export const UndoIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </svg>
);

export const FlipIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M17 1l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 23l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);

export const MenuIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

export const XIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const CheckIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ChevronLeft = ({ size = 18, className, style }: IconProps) => (
  <svg {...svgProps(size, className, style)}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRight = ({ size = 18, className, style }: IconProps) => (
  <svg {...svgProps(size, className, style)}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const RobotIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <rect x="4" y="8" width="16" height="12" rx="2" />
    <path d="M12 8V4M8 4h8" />
    <circle cx="9" cy="13" r="1" fill="currentColor" />
    <circle cx="15" cy="13" r="1" fill="currentColor" />
  </svg>
);

export const UsersIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="10" cy="7" r="4" />
    <path d="M21 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const PuzzleIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.66.27 1.18.83 1.51 1z" />
  </svg>
);

export const ChartIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-6 4 3 5-8" />
  </svg>
);

export const ClockIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15.5 13.5" />
  </svg>
);

export const HandshakeIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M11 17l-1.5 1.5a2.1 2.1 0 0 1-3-3L11 11l3 3h4l3-3-5-5h-6l-2 2" />
    <path d="M3 8l4-4h6" />
  </svg>
);

export const PlayIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none" />
  </svg>
);

export const LightbulbIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.3 1 2.1h5c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3z" />
  </svg>
);

export const ArrowRight = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <line x1="4" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
  </svg>
);

export const TrashIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const PlusIcon = ({ size = 18, className }: IconProps) => (
  <svg {...svgProps(size, className)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
