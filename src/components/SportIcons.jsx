// Icons for the two Phase 1 sports (lucide has no racket sports).
const base = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
};

export function TableTennisIcon({ className = "" }) {
  return (
    <svg {...base} className={className}>
      {/* paddle: solid face, separate short handle, ball */}
      <g transform="rotate(-35 22 24)">
        <ellipse cx="22" cy="16" rx="13" ry="14" fill="currentColor" stroke="none" />
        <rect x="19" y="33" width="6" height="10" rx="2" fill="currentColor" stroke="none" />
      </g>
      <circle cx="40" cy="9" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BadmintonIcon({ className = "" }) {
  return (
    <svg {...base} className={className}>
      <g transform="rotate(35 24 24)">
        <circle cx="24" cy="39" r="5" fill="currentColor" stroke="none" />
        <path d="M21 35 L12 8 H36 L27 35 Z" fill="currentColor" fillOpacity="0.35" />
        <path d="M18 8 L22 35 M24 8 V34 M30 8 L26 35" strokeWidth="1.5" />
      </g>
    </svg>
  );
}

export const SPORT_ICONS = {
  "table-tennis": TableTennisIcon,
  badminton: BadmintonIcon,
};
