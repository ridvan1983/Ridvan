import { useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { brand } from '~/config/brand';
import { examplePrompts } from '~/config/examplePrompts';
import { SafeImage } from '~/components/ui/SafeImage';

export function LandingPage() {
  const navigate = useNavigate();
  const [heroPrompt, setHeroPrompt] = useState('');
  const [ctaPrompt, setCtaPrompt] = useState('');

  const goToChatWithPrompt = (prompt: string) => {
    const trimmedPrompt = prompt.trim();
    const target = trimmedPrompt.length > 0 ? `/chat?prompt=${encodeURIComponent(trimmedPrompt)}` : '/chat';
    navigate(target);
  };

  return (
    <div className="min-h-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
      <header className="sticky top-0 z-20 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <a href="/" className="text-xl font-semibold">
            {brand.appName}
          </a>
          <nav className="flex items-center gap-3 text-sm">
            <a href="/pricing" className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary">
              Pricing
            </a>
            <a href="/login" className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary">
              Log in
            </a>
            <a
              href="/login"
              className="rounded-lg px-4 py-2 text-white font-medium"
              style={{ backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})` }}
            >
              Get Started
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-7xl px-6 pt-20 pb-16">
          <div className="max-w-4xl">
            <h1 className="text-4xl sm:text-6xl leading-tight font-bold">Your idea. Our AI. Your app.</h1>
            <p className="mt-5 text-lg text-bolt-elements-textSecondary max-w-3xl">
              Describe what you want to build. Ridvan turns it into a working app in seconds.
            </p>
          </div>

          <div className="mt-8 max-w-4xl overflow-hidden rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
            <SafeImage
              alt="Landing hero"
              className="h-56 w-full object-cover"
            />
          </div>

          <div className="mt-8 max-w-4xl rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
            <textarea
              rows={3}
              value={heroPrompt}
              onChange={(event) => setHeroPrompt(event.target.value)}
              placeholder="Describe your app idea..."
              className="w-full resize-none rounded-lg bg-bolt-elements-background-depth-1 p-4 text-base focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => goToChatWithPrompt(heroPrompt)}
                className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                style={{ backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})` }}
              >
                Start building →
              </button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 max-w-4xl">
            {examplePrompts.map((item) => (
              <button
                key={item.label}
                onClick={() => setHeroPrompt(item.prompt)}
                className="rounded-full border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-14">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6">
              <h3 className="text-lg font-semibold">AI-Powered</h3>
              <p className="mt-2 text-sm text-bolt-elements-textSecondary">
                Describe your idea in plain language and watch it come to life.
              </p>
            </div>
            <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6">
              <h3 className="text-lg font-semibold">Instant Preview</h3>
              <p className="mt-2 text-sm text-bolt-elements-textSecondary">
                See your app running in real-time as it's being built.
              </p>
            </div>
            <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6">
              <h3 className="text-lg font-semibold">Production Ready</h3>
              <p className="mt-2 text-sm text-bolt-elements-textSecondary">
                Export clean, deployable code. No vendor lock-in.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-14">
          <div className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-8">
            <h2 className="text-2xl font-semibold">Trusted by builders</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div>
                <div className="text-3xl font-bold">1,000+</div>
                <div className="text-sm text-bolt-elements-textSecondary">apps built</div>
              </div>
              <div>
                <div className="text-3xl font-bold">500+</div>
                <div className="text-sm text-bolt-elements-textSecondary">builders</div>
              </div>
              <div>
                <div className="text-3xl font-bold">95%</div>
                <div className="text-sm text-bolt-elements-textSecondary">success rate</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16">
          <div className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-8">
            <h2 className="text-3xl font-bold">Ready to build?</h2>
            <p className="mt-2 text-bolt-elements-textSecondary">Start for free — no credit card required</p>

            <div className="mt-6">
              <textarea
                rows={2}
                value={ctaPrompt}
                onChange={(event) => setCtaPrompt(event.target.value)}
                placeholder="Describe your app idea..."
                className="w-full resize-none rounded-lg bg-bolt-elements-background-depth-1 p-4 text-base focus:outline-none"
              />
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => goToChatWithPrompt(ctaPrompt)}
                  className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                  style={{ backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})` }}
                >
                  Start building →
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-bolt-elements-borderColor">
        <div className="mx-auto max-w-7xl px-6 py-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm text-bolt-elements-textSecondary">
          <div>{brand.appName} © 2026</div>
          <div className="flex gap-4">
            <a href="/pricing" className="hover:text-bolt-elements-textPrimary">
              Pricing
            </a>
            <a href="/login" className="hover:text-bolt-elements-textPrimary">
              Login
            </a>
            <a href="#" className="hover:text-bolt-elements-textPrimary">
              Terms
            </a>
            <a href="#" className="hover:text-bolt-elements-textPrimary">
              Privacy
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
