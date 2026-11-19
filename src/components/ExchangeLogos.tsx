import React, {useId} from 'react';
import type {ExchangeType} from '../types/trading';

interface LogoProps {
  className?: string;
}

export const BinanceLogoSvg: React.FC<LogoProps> = ({className = 'h-9 w-9'}) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <g fill="#F0B90B">
      {/* Top Chevron */}
      <polygon points="32,7 49,24 43.5,29.5 32,18 20.5,29.5 15,24" />
      {/* Bottom Chevron */}
      <polygon points="32,57 49,40 43.5,34.5 32,46 20.5,34.5 15,40" />
      {/* Center Diamond */}
      <polygon points="32,25.5 38.5,32 32,38.5 25.5,32" />
      {/* Left Diamond */}
      <polygon points="12,26.5 17.5,32 12,37.5 6.5,32" />
      {/* Right Diamond */}
      <polygon points="52,26.5 57.5,32 52,37.5 46.5,32" />
    </g>
  </svg>
);

export const MexcLogoSvg: React.FC<LogoProps> = ({className = 'h-9 w-9'}) => {
  const uid = useId().replace(/:/g, '');
  const gradA = `mexcRibbonA_${uid}`;
  const gradB = `mexcRibbonB_${uid}`;

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradA} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00E5FF" />
          <stop offset="100%" stopColor="#0075FF" />
        </linearGradient>
        <linearGradient id={gradB} x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0095FF" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
      {/* Left & Center Ascending Peak Ribbon */}
      <path
        d="M7 44 L21 18 C23.2 14 28.8 14 31 18 L39 33 L31.5 44 L25 31.5 L16.5 46 C14.5 49.2 9.5 48.2 7 44 Z"
        fill={`url(#${gradA})`}
      />
      {/* Right Peak Ribbon */}
      <path
        d="M32 34 L39 20 C41.2 15.8 46.8 15.8 49 20 L57 38 C58.6 41.8 55.6 46 51.4 46 L42.5 46 L36.5 35 Z"
        fill={`url(#${gradB})`}
      />
    </svg>
  );
};

export const ExchangeBrandLogo: React.FC<{
  exchange: ExchangeType;
  className?: string;
}> = ({exchange, className = 'h-6 w-6'}) =>
  exchange === 'MEXC' ? (
    <MexcLogoSvg className={className} />
  ) : (
    <BinanceLogoSvg className={className} />
  );
