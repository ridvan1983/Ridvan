import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@remix-run/react';
import { toast } from 'react-toastify';
import { brand } from '~/config/brand';
import { useAuth } from '~/lib/auth/AuthContext';
import { listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(date);
}

function createClientProjectId() {
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
}

export function ProjectsListPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const items = await listProjects(accessToken);
        if (!cancelled) {
          setProjects(items);
        }
      } catch {
        if (!cancelled) {
          toast.error('Failed to load projects');
          setProjects([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const onNewProject = () => {
    const id = createClientProjectId();
    navigate(`/chat?projectId=${encodeURIComponent(id)}`);
  };

  const sorted = [...projects].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));

  return (
    <main className="flex-1 min-h-0 overflow-auto bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-bolt-elements-textPrimary">Mina projekt</h1>
            <p className="mt-1 text-sm text-bolt-elements-textSecondary">Alla dina sparade projekt i {brand.appName}.</p>
          </div>
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold text-white shrink-0"
            style={{
              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
            }}
          >
            Nytt projekt
          </button>
        </div>

        {loading ? (
          <div className="mt-10 text-bolt-elements-textSecondary">Laddar projekt…</div>
        ) : sorted.length === 0 ? (
          <div className="mt-10 rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-8 text-center text-bolt-elements-textSecondary">
            <p>Du har inga projekt ännu.</p>
            <button
              type="button"
              onClick={onNewProject}
              className="mt-4 text-sm font-medium text-bolt-elements-item-contentAccent hover:underline"
            >
              Skapa ditt första projekt →
            </button>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/chat?projectId=${encodeURIComponent(p.id)}`}
                  className="block rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 shadow-sm transition-theme hover:border-bolt-elements-item-contentAccent/40 hover:bg-bolt-elements-background-depth-3"
                >
                  <div className="font-semibold text-bolt-elements-textPrimary truncate">{p.title ?? 'Untitled project'}</div>
                  <div className="mt-1 text-xs text-bolt-elements-textSecondary">Senast ändrad: {formatUpdatedAt(p.updatedAt)}</div>
                  {p.previewUrl ? (
                    <div className="mt-2 text-xs text-bolt-elements-textTertiary truncate" title={p.previewUrl}>
                      {p.previewUrl}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-bolt-elements-textTertiary">Ingen publicerad preview ännu</div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
