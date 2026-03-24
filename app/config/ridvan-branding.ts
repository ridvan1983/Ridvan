// Ridvan Branding Configuration
// Built for Ridvan Platform under the repository license terms

export const RIDVAN_BRANDING = {
  // Core identity
  name: 'Ridvan',
  fullName: 'Ridvan AI Platform',
  tagline: 'AI-Powered Full-Stack Development',
  
  // Colors - Premium tech palette
  colors: {
    primary: '#6366f1', // Indigo
    primaryDark: '#4f46e5',
    primaryLight: '#818cf8',
    secondary: '#8b5cf6', // Purple
    accent: '#06b6d4', // Cyan
    success: '#10b981', // Emerald
    warning: '#f59e0b', // Amber
    error: '#ef4444', // Red
    neutral: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
    }
  },
  
  // Typography
  fonts: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
    display: ['CalSans', 'Inter', 'system-ui', 'sans-serif']
  },
  
  // Spacing and sizing
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    '2xl': '3rem',
    '3xl': '4rem',
  },
  
  // Border radius
  borderRadius: {
    sm: '0.25rem',
    md: '0.375rem',
    lg: '0.5rem',
    xl: '0.75rem',
    '2xl': '1rem',
    full: '9999px',
  },
  
  // Shadows
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
    xl: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
  },
  
  // Animation
  transitions: {
    fast: '150ms ease-in-out',
    base: '250ms ease-in-out',
    slow: '350ms ease-in-out',
  }
} as const;

// CSS custom properties for runtime usage
export const CSS_VARIABLES = {
  '--ridvan-primary': RIDVAN_BRANDING.colors.primary,
  '--ridvan-primary-dark': RIDVAN_BRANDING.colors.primaryDark,
  '--ridvan-primary-light': RIDVAN_BRANDING.colors.primaryLight,
  '--ridvan-secondary': RIDVAN_BRANDING.colors.secondary,
  '--ridvan-accent': RIDVAN_BRANDING.colors.accent,
  '--ridvan-success': RIDVAN_BRANDING.colors.success,
  '--ridvan-warning': RIDVAN_BRANDING.colors.warning,
  '--ridvan-error': RIDVAN_BRANDING.colors.error,
  '--ridvan-font-sans': RIDVAN_BRANDING.fonts.sans.join(', '),
  '--ridvan-font-mono': RIDVAN_BRANDING.fonts.mono.join(', '),
  '--ridvan-font-display': RIDVAN_BRANDING.fonts.display.join(', '),
} as const;
