import React from 'react';

export function LeominalMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="leominal-mark" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="leominal-mark-glow" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#5eead4" stopOpacity="0.6" />
          <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#leominal-mark-glow)" />
      <path
        d="M6 10l4 2-1 4 3 1-1 3 5-1 5 1-1-3 3-1-1-4 4-2-5 1-2-3-3 2-3-2-2 3-5-1z"
        fill="#0b1418"
        stroke="#5eead4"
        strokeLinejoin="round"
        strokeWidth="0.9"
      />
      <path d="M11 15l2 2-2 2M15 19h4" stroke="#5eead4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" />
    </svg>
  );
}
