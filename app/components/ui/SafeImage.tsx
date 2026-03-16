import { useMemo, useState } from 'react';

type SafeImageProps = React.ImgHTMLAttributes<HTMLImageElement>;

const FALLBACK_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1f2937"/>
        <stop offset="100%" stop-color="#111827"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="675" fill="url(#bg)"/>
    <circle cx="1040" cy="120" r="180" fill="#374151" opacity="0.35"/>
    <circle cx="180" cy="560" r="220" fill="#4b5563" opacity="0.25"/>
    <text x="50%" y="50%" fill="#e5e7eb" font-size="42" font-family="Arial, sans-serif" text-anchor="middle" dominant-baseline="middle">Preview Image</text>
  </svg>`,
);

const DEFAULT_FALLBACK_SRC = `data:image/svg+xml;charset=utf-8,${FALLBACK_SVG}`;

export function SafeImage({ src, alt, onError, ...props }: SafeImageProps) {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const [hasFallback, setHasFallback] = useState(normalizedSrc.length === 0);
  const resolvedSrc = useMemo(() => {
    if (hasFallback || normalizedSrc.length === 0) {
      return DEFAULT_FALLBACK_SRC;
    }

    return normalizedSrc;
  }, [hasFallback, normalizedSrc]);

  return (
    <img
      {...props}
      src={resolvedSrc}
      alt={alt ?? 'Image'}
      loading={props.loading ?? 'lazy'}
      onError={(event) => {
        if (!hasFallback) {
          setHasFallback(true);
        }

        onError?.(event);
      }}
    />
  );
}
