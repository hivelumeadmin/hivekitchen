type IconProps = Readonly<{ readonly className?: string }>;

function outlineSvg(props: IconProps & Readonly<{ readonly children: React.ReactNode }>) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {props.children}
    </svg>
  );
}

// --- Chrome / navigation -----------------------------------------------------

export function BellIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    ),
  });
}

export function UserCircleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="10" r="3" />
        <path d="M7 20.5a7 7 0 0 1 10 0" />
      </>
    ),
  });
}

export function ChevronLeftIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: <polyline points="15 18 9 12 15 6" />,
  });
}

export function ChevronRightIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: <polyline points="9 6 15 12 9 18" />,
  });
}

export function GlobeIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    ),
  });
}

export function ShieldIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    ),
  });
}

export function UtensilsIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M3 2v7a3 3 0 0 0 3 3v10" />
        <path d="M9 2v7a3 3 0 0 1-3 3" />
        <path d="M15 22V11a4 4 0 0 1 4-4V2" />
      </>
    ),
  });
}

export function EditIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </>
    ),
  });
}

export function AlertTriangleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </>
    ),
  });
}

// --- State indicators --------------------------------------------------------

export function PauseCircleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="10" y1="9" x2="10" y2="15" />
        <line x1="14" y1="9" x2="14" y2="15" />
      </>
    ),
  });
}

export function CheckCircleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  });
}

export function ClockIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </>
    ),
  });
}

// --- Actions -----------------------------------------------------------------

export function RefreshIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
        <path d="M3 21v-5h5" />
      </>
    ),
  });
}

export function CalendarIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </>
    ),
  });
}

export function PlusIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
  });
}

export function MinusIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: <line x1="5" y1="12" x2="19" y2="12" />,
  });
}

export function CheckIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: <polyline points="5 12 10 17 19 7" />,
  });
}

export function AddCircleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </>
    ),
  });
}

export function SyncIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </>
    ),
  });
}

export function ForumIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </>
    ),
  });
}

export function StorefrontIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M3 9 4 3h16l1 6" />
        <path d="M4 9v12h16V9" />
        <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
      </>
    ),
  });
}

export function ShoppingBasketIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M5 11h14l-1.5 8a2 2 0 0 1-2 2H8.5a2 2 0 0 1-2-2L5 11Z" />
        <path d="m8 11 4-7 4 7" />
        <line x1="3" y1="11" x2="21" y2="11" />
      </>
    ),
  });
}

export function TrashIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    ),
  });
}

export function AppleLogoIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01M12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25" />
    </svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <polyline points="2 6 12 13 22 6" />
      </>
    ),
  });
}

export function LockIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  });
}

export function EyeIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  });
}

export function EyeOffIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </>
    ),
  });
}

export function GoogleLogoIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </>
    ),
  });
}

export function SparkleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <path d="M12 3 13.5 9.5 20 11l-6.5 1.5L12 19l-1.5-6.5L4 11l6.5-1.5Z" />
    ),
  });
}

export function TimerIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="10" y1="2" x2="14" y2="2" />
        <line x1="12" y1="14" x2="15" y2="11" />
        <circle cx="12" cy="14" r="8" />
      </>
    ),
  });
}

export function SyncAltIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <polyline points="16 3 21 8 16 13" />
        <line x1="3" y1="8" x2="21" y2="8" />
        <polyline points="8 21 3 16 8 11" />
        <line x1="3" y1="16" x2="21" y2="16" />
      </>
    ),
  });
}

export function ImageIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <polyline points="21 15 16 10 5 21" />
      </>
    ),
  });
}

export function SunIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </>
    ),
  });
}

export function MoonIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  });
}

export function AwardIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="8" r="6" />
        <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
      </>
    ),
  });
}

export function PlayCircleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </>
    ),
  });
}

export function PlayArrowIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="6 4 20 12 6 20 6 4" />
    </svg>
  );
}

export function ArticleIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="7" y1="8" x2="17" y2="8" />
        <line x1="7" y1="12" x2="17" y2="12" />
        <line x1="7" y1="16" x2="13" y2="16" />
      </>
    ),
  });
}

export function SendIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
  });
}

export function ArrowRightIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </>
    ),
  });
}

export function WaveformIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="3" y1="12" x2="3" y2="12" />
        <line x1="7" y1="9" x2="7" y2="15" />
        <line x1="11" y1="5" x2="11" y2="19" />
        <line x1="15" y1="8" x2="15" y2="16" />
        <line x1="19" y1="10" x2="19" y2="14" />
      </>
    ),
  });
}

// --- Themed (stroke icons used as inline decoration) --------------------------

export function StarIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

/** Identical glyph to StarIcon — kept as a separate export for call-site clarity. */
export const StarFilledIcon = StarIcon;

export function ShieldCheckIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  });
}

export function LeafIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M11 20A7 7 0 0 1 4 13V7a5 5 0 0 1 5-5h6a7 7 0 0 1 7 7v0a11 11 0 0 1-11 11Z" />
        <path d="M2 22 11 13" />
      </>
    ),
  });
}

export function LightbulbIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.7c.5.4.8 1 .9 1.6l.1 1.7h6l.1-1.7c.1-.6.4-1.2.9-1.6A7 7 0 0 0 12 2Z" />
      </>
    ),
  });
}

export function MenuBookIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </>
    ),
  });
}

export function PackageIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <path d="m7.5 4.27 9 5.15" />
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" y1="22" x2="12" y2="12" />
      </>
    ),
  });
}

export function NutritionIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <path d="M11.7 4a3 3 0 1 1 4.3 0 5 5 0 0 1 4 5c0 3-2.7 8-7.5 11.5h-1c-4.8-3.5-7.5-8.5-7.5-11.5a5 5 0 0 1 4-5 3 3 0 1 1 3.7-.4Z" />
    ),
  });
}

export function MenuIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </>
    ),
  });
}

export function XIcon({ className }: IconProps) {
  return outlineSvg({
    className,
    children: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
  });
}

