import type { User } from '@supabase/supabase-js';
import { useMemo, useEffect, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import CreditDisplay from '~/components/credits/CreditDisplay';
import { brand } from '~/config/brand';
import type { Project } from '~/lib/projects/types';
import { listProjects } from '~/lib/projects/api.client';

interface LoggedInDashboardProps {
  user: User;
  accessToken: string;
  onSubmitPrompt: (prompt: string) => void;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function initialsFromUser(user: User) {
  const email = user.email ?? '';
  const base = (user.user_metadata?.full_name as string | undefined) ?? email;
  const parts = String(base)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const a = parts[0]?.[0] ?? 'U';
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? '';
  return `${a}${b}`.toUpperCase();
}

export function LoggedInDashboard({ user, accessToken, onSubmitPrompt }: LoggedInDashboardProps) {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [activeTab, setActiveTab] = useState<'projects' | 'recent'>('projects');

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (typeof user.email === 'string' && user.email.includes('@') ? user.email.split('@')[0] : '');

  const initials = useMemo(() => initialsFromUser(user), [user]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoadingProjects(true);
      try {
        const items = await listProjects(accessToken);
        if (!cancelled) {
          setProjects(items);
        }
      } finally {
        if (!cancelled) {
          setLoadingProjects(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const recentProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
    return sorted.slice(0, 6);
  }, [projects]);

  const sidebarProjects = useMemo(() => {
    const sorted = [...projects].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
    return sorted.slice(0, 8);
  }, [projects]);

  const gridProjects = activeTab === 'recent' ? recentProjects : projects;

  const BRAND_GRADIENT = 'linear-gradient(135deg, #7C3AED, #EC4899, #F59E0B)';
  const BUTTON_GRADIENT = 'linear-gradient(135deg, #7C3AED, #EC4899)';

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: '#F8F7F4', color: '#0A0A0A' }}>
      <aside
        className="w-[280px] shrink-0 border-r px-4 py-5 flex flex-col"
        style={{ backgroundColor: '#FFFFFF', borderColor: '#E8E6E1' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="h-10 w-10 rounded-full flex items-center justify-center text-sm font-semibold"
            style={{ backgroundImage: BUTTON_GRADIENT, color: '#FFFFFF' }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: '#0A0A0A' }}>
              {brand.appName}
            </div>
            <div className="text-xs truncate" style={{ color: '#6B6B6B' }}>
              {displayName ? `Hej, ${displayName}` : 'Välkommen tillbaka'}
            </div>
          </div>
        </div>

        <nav className="mt-6 flex flex-col gap-1 text-sm">
          <button
            className="text-left rounded-lg px-3 py-2 hover:opacity-80"
            style={{ color: '#0A0A0A', backgroundColor: '#F8F7F4' }}
            onClick={() => navigate('/')}
          >
            Home
          </button>
          <button
            className="text-left rounded-lg px-3 py-2 hover:opacity-80"
            style={{ color: '#0A0A0A' }}
            onClick={() => navigate('/projects')}
          >
            Mina projekt
          </button>
          <button
            className="text-left rounded-lg px-3 py-2 hover:opacity-80"
            style={{ color: '#0A0A0A' }}
            onClick={() => navigate('/mentor')}
          >
            Mentor
          </button>
        </nav>

        <div className="mt-6">
          <div className="text-xs font-semibold" style={{ color: '#6B6B6B' }}>
            Mina projekt
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {loadingProjects ? (
              <div className="text-xs" style={{ color: '#6B6B6B' }}>
                Laddar...
              </div>
            ) : sidebarProjects.length === 0 ? (
              <div className="text-xs" style={{ color: '#6B6B6B' }}>
                Inga projekt ännu
              </div>
            ) : (
              sidebarProjects.map((p) => (
                <a
                  key={p.id}
                  href={`/chat?projectId=${encodeURIComponent(p.id)}`}
                  className="rounded-lg px-2 py-2 hover:opacity-80"
                  style={{ color: '#0A0A0A' }}
                >
                  <div className="text-sm font-medium truncate">{p.title ?? 'Untitled project'}</div>
                  <div className="text-[11px]" style={{ color: '#6B6B6B' }}>
                    {formatUpdatedAt(p.updatedAt)}
                  </div>
                </a>
              ))
            )}
          </div>
        </div>

        <div className="mt-auto pt-6 flex flex-col gap-3">
          <div className="text-xs" style={{ color: '#6B6B6B' }}>
            <CreditDisplay />
          </div>
          <a href="/profile" className="text-sm hover:opacity-80" style={{ color: '#0A0A0A' }}>
            Profil
          </a>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div
          className="min-h-screen"
          style={{
            backgroundImage: BRAND_GRADIENT,
            backgroundAttachment: 'fixed',
          }}
        >
          <div className="px-6 py-10">
            <div className="mx-auto max-w-5xl">
              <h1 className="text-3xl sm:text-4xl font-bold" style={{ color: '#FFFFFF' }}>
                Låt oss bygga något{displayName ? `, ${displayName}` : ''}
              </h1>

              <div className="mt-6 rounded-2xl border p-4" style={{ backgroundColor: '#FFFFFF', borderColor: 'rgba(255, 255, 255, 0.35)' }}>
                <textarea
                  rows={2}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Beskriv vad du vill bygga..."
                  className="w-full resize-none rounded-lg p-4 text-base focus:outline-none"
                  style={{ backgroundColor: '#FFFFFF', color: '#0A0A0A' }}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
                    style={{ backgroundImage: BUTTON_GRADIENT }}
                    onClick={() => onSubmitPrompt(prompt)}
                  >
                    Start building →
                  </button>
                </div>
              </div>

              <div className="mt-10">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold" style={{ color: '#FFFFFF' }}>
                    Mina projekt
                  </h2>
                  <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.35)' }}>
                    <button
                      className="px-3 py-1.5 text-sm"
                      style={{
                        color: '#FFFFFF',
                        backgroundColor: activeTab === 'projects' ? 'rgba(255,255,255,0.20)' : 'transparent',
                      }}
                      onClick={() => setActiveTab('projects')}
                    >
                      Mina projekt
                    </button>
                    <button
                      className="px-3 py-1.5 text-sm"
                      style={{
                        color: '#FFFFFF',
                        backgroundColor: activeTab === 'recent' ? 'rgba(255,255,255,0.20)' : 'transparent',
                      }}
                      onClick={() => setActiveTab('recent')}
                    >
                      Senast visade
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {loadingProjects ? (
                    Array.from({ length: 6 }).map((_, idx) => (
                      <div
                        key={idx}
                        className="rounded-2xl border p-4"
                        style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.30)' }}
                      >
                        <div className="h-24 rounded-xl" style={{ backgroundColor: 'rgba(255,255,255,0.20)' }} />
                        <div className="mt-3 h-4 w-2/3 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.20)' }} />
                        <div className="mt-2 h-3 w-1/2 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />
                      </div>
                    ))
                  ) : gridProjects.length === 0 ? (
                    <div className="text-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>
                      Inga projekt ännu. Skriv en idé ovan för att skapa ditt första.
                    </div>
                  ) : (
                    gridProjects.map((p) => (
                      <a
                        key={p.id}
                        href={`/chat?projectId=${encodeURIComponent(p.id)}`}
                        className="rounded-2xl border p-4 hover:opacity-95"
                        style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.30)' }}
                      >
                        <div
                          className="h-28 rounded-xl border"
                          style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.25)' }}
                        />
                        <div className="mt-3 text-base font-semibold" style={{ color: '#FFFFFF' }}>
                          {p.title ?? 'Untitled project'}
                        </div>
                        <div className="mt-1 text-xs" style={{ color: 'rgba(255,255,255,0.85)' }}>
                          Senast ändrad: {formatUpdatedAt(p.updatedAt)}
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
