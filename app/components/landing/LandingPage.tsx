import { useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { brand } from '~/config/brand';
import { useAuth } from '~/lib/auth/AuthContext';
import { usePromptEnhancer } from '~/lib/hooks/usePromptEnhancer';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { classNames } from '~/utils/classNames';

export function LandingPage() {
  const navigate = useNavigate();
  const [heroPrompt, setHeroPrompt] = useState('');
  const [ctaPrompt, setCtaPrompt] = useState('');
  const { session } = useAuth();
  const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();

  const BRAND_GRADIENT = 'linear-gradient(135deg, #7C3AED, #EC4899)';

  const createClientProjectId = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch {
      // ignore
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  };

  const goToChatWithPrompt = (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    const projectId = createClientProjectId();
    const target = trimmedPrompt.length > 0
      ? `/chat?projectId=${encodeURIComponent(projectId)}&prompt=${encodeURIComponent(trimmedPrompt)}`
      : `/chat?projectId=${encodeURIComponent(projectId)}`;

    if (!session?.access_token) {
      navigate(`/login?redirect=${encodeURIComponent(target)}`);
      return;
    }

    navigate(target);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8F7F4', color: '#0A0A0A' }}>
      <ClientOnly>{() => <Menu />}</ClientOnly>
      <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ borderColor: '#E8E6E1', backgroundColor: 'rgba(248, 247, 244, 0.9)' }}>
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold" style={{ color: '#0A0A0A' }}>
            {brand.appName}
          </a>
          <nav className="flex items-center gap-3 text-sm">
            <a href="/pricing" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Pricing
            </a>
            <a href="/login" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Log in
            </a>
            <a
              href="/login"
              className="rounded-lg px-4 py-2 text-white font-medium"
              style={{ backgroundImage: BRAND_GRADIENT }}
            >
              Get Started
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-7xl px-6 pt-14 pb-12">
          <div className="max-w-4xl">
            <div
              className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: 'rgba(124, 58, 237, 0.10)', color: '#0A0A0A' }}
            >
              Build in minutes with AI
            </div>

            <h1 className="mt-5 text-4xl sm:text-6xl leading-tight font-bold" style={{ color: '#0A0A0A' }}>
              Your idea.{' '}
              <span
                style={{
                  backgroundImage: BRAND_GRADIENT,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                Our AI
              </span>
              . Your{' '}
              <span
                style={{
                  backgroundImage: BRAND_GRADIENT,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                app
              </span>
              .
            </h1>
            <p className="mt-5 text-lg max-w-3xl" style={{ color: '#6B6B6B' }}>
              Describe what you want to build. Ridvan turns it into a working app in seconds.
            </p>

            <div className="mt-7 rounded-2xl border p-4" style={{ backgroundColor: '#FFFFFF', borderColor: '#E8E6E1' }}>
              <textarea
                rows={3}
                value={heroPrompt}
                onChange={(event) => {
                  setHeroPrompt(event.target.value);
                  resetEnhancer();
                }}
                placeholder="Describe your app idea..."
                className="w-full resize-none rounded-lg p-4 text-base focus:outline-none"
                style={{ backgroundColor: '#FFFFFF', color: '#0A0A0A' }}
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center">
                  <IconButton
                    title="Enhance prompt"
                    disabled={enhancingPrompt || heroPrompt.trim().length === 0}
                    className={classNames(
                      'border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary enabled:hover:text-bolt-elements-textPrimary enabled:hover:bg-bolt-elements-item-backgroundActive rounded-lg px-2 py-1',
                      {
                        'opacity-100!': enhancingPrompt,
                        'text-bolt-elements-item-contentAccent! pr-1.5 enabled:hover:bg-bolt-elements-item-backgroundAccent!':
                          promptEnhanced,
                      },
                    )}
                    onClick={() => {
                      if (!session?.access_token) {
                        const trimmedPrompt = heroPrompt.trim();
                        const projectId = createClientProjectId();
                        const redirectTarget = trimmedPrompt.length > 0
                          ? `/chat?projectId=${encodeURIComponent(projectId)}&prompt=${encodeURIComponent(trimmedPrompt)}`
                          : `/chat?projectId=${encodeURIComponent(projectId)}`;
                        navigate(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
                        return;
                      }

                      enhancePrompt(heroPrompt, setHeroPrompt, session.access_token);
                    }}
                  >
                    {enhancingPrompt ? (
                      <>
                        <div className="i-svg-spinners:90-ring-with-bg text-bolt-elements-loader-progress text-xl"></div>
                        <div className="ml-1.5">Enhancing prompt...</div>
                      </>
                    ) : (
                      <>
                        <div className="i-ph:sparkle text-xl"></div>
                        <div className="ml-1.5">{promptEnhanced ? 'Prompt enhanced' : session?.access_token ? 'AI Enhance' : 'Log in to Enhance'}</div>
                      </>
                    )}
                  </IconButton>
                </div>
                <button
                  onClick={() => goToChatWithPrompt(heroPrompt)}
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                  style={{ backgroundImage: BRAND_GRADIENT }}
                >
                  Start building →
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {['E-handel', 'Bokningssystem', 'Dashboard', 'CRM', 'Portfolio'].map((label) => (
                <button
                  key={label}
                  onClick={() => setHeroPrompt(label)}
                  className="rounded-full border px-3 py-1.5 text-sm hover:opacity-80"
                  style={{ borderColor: '#E8E6E1', backgroundColor: '#FFFFFF', color: '#6B6B6B' }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-4 max-w-4xl md:grid-cols-3">
            {[{ title: 'Builder', desc: 'Turns your idea into a working app automatically.' }, { title: 'Mentor', desc: 'Guides you through product decisions and best practices.' }, { title: 'Vertical', desc: 'Adapts output to your industry with tailored UI and content.' }].map(
              (card) => (
                <div
                  key={card.title}
                  className="rounded-xl border p-6"
                  style={{ backgroundColor: '#FFFFFF', borderColor: '#E8E6E1', borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: 'transparent' }}
                >
                  <div style={{ position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: -4,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        backgroundImage: BRAND_GRADIENT,
                        borderTopLeftRadius: 12,
                        borderBottomLeftRadius: 12,
                      }}
                    />
                    <h3 className="text-lg font-semibold" style={{ color: '#0A0A0A' }}>
                      {card.title}
                    </h3>
                    <p className="mt-2 text-sm" style={{ color: '#6B6B6B' }}>
                      {card.desc}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        </section>
      </main>

      <footer className="border-t" style={{ borderColor: '#E8E6E1' }}>
        <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm" style={{ color: '#6B6B6B' }}>
          <div>{brand.appName} © 2026</div>
          <div className="flex gap-4">
            <a href="/pricing" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Pricing
            </a>
            <a href="/login" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Login
            </a>
            <a href="#" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Terms
            </a>
            <a href="#" className="hover:opacity-80" style={{ color: '#6B6B6B' }}>
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
