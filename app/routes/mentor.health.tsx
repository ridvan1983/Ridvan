import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useEffect, useMemo, useState } from 'react';
import { Header } from '~/components/header/Header';
import { useAuth } from '~/lib/auth/AuthContext';
import { listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';
import { readMentorHealth, writeMentorHealth } from '~/lib/mentor/api.client';

export const meta: MetaFunction = () => {
  return [{ title: 'Hälsokoll — Mentor' }];
};

export async function loader() {
  return json({});
}

type HealthMetric = {
  id: string;
  metric: string;
  status: 'green' | 'yellow' | 'red';
  value: string | null;
  notes: string | null;
  recorded_at: string;
};

function statusLabel(status: HealthMetric['status']) {
  if (status === 'green') return 'Grönt';
  if (status === 'red') return 'Rött';
  return 'Gult';
}

function statusDotClass(status: HealthMetric['status']) {
  if (status === 'green') return 'bg-emerald-400';
  if (status === 'red') return 'bg-red-400';
  return 'bg-amber-400';
}

export default function MentorHealthRoute() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');

  const [metrics, setMetrics] = useState<Array<HealthMetric | null>>([]);
  const [metricNames, setMetricNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [draftValueByMetric, setDraftValueByMetric] = useState<Record<string, string>>({});
  const [draftNotesByMetric, setDraftNotesByMetric] = useState<Record<string, string>>({});
  const [draftStatusByMetric, setDraftStatusByMetric] = useState<Record<string, HealthMetric['status']>>({});
  const [isSaving, setIsSaving] = useState<Record<string, boolean>>({});

  const selectedProject = useMemo(() => projects.find((p) => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const pid = url.searchParams.get('projectId');
    if (pid) {
      setSelectedProjectId(pid);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      setSelectedProjectId('');
      return;
    }

    listProjects(accessToken)
      .then((items) => {
        setProjects(items);
        if (!selectedProjectId) {
          const url = new URL(window.location.href);
          const pid = url.searchParams.get('projectId');
          const next = pid ?? (items[0]?.id ?? '');
          setSelectedProjectId(next);
        }
      })
      .catch(() => {
        setProjects([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || !selectedProjectId) {
      setMetrics([]);
      setMetricNames([]);
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set('projectId', selectedProjectId);
    window.history.replaceState({}, '', url.toString());

    setIsLoading(true);
    setError('');

    readMentorHealth(accessToken, selectedProjectId)
      .then((res) => {
        setMetrics((res.metrics ?? []) as Array<HealthMetric | null>);
        setMetricNames(res.allMetrics ?? []);

        const nextStatus: Record<string, HealthMetric['status']> = {};
        const nextValue: Record<string, string> = {};
        const nextNotes: Record<string, string> = {};

        for (let i = 0; i < (res.metrics ?? []).length; i++) {
          const name = (res.allMetrics ?? [])[i];
          const row = (res.metrics ?? [])[i] as HealthMetric | null;
          if (!name) continue;
          nextStatus[name] = row?.status ?? 'yellow';
          nextValue[name] = row?.value ?? '';
          nextNotes[name] = row?.notes ?? '';
        }

        setDraftStatusByMetric(nextStatus);
        setDraftValueByMetric(nextValue);
        setDraftNotesByMetric(nextNotes);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load health');
        setMetrics([]);
        setMetricNames([]);
      })
      .finally(() => setIsLoading(false));
  }, [accessToken, selectedProjectId]);

  const onSaveMetric = async (metric: string) => {
    if (!accessToken || !selectedProjectId) {
      return;
    }

    setIsSaving((prev) => ({ ...prev, [metric]: true }));
    setError('');

    try {
      await writeMentorHealth(accessToken, {
        projectId: selectedProjectId,
        metric,
        status: draftStatusByMetric[metric] ?? 'yellow',
        value: draftValueByMetric[metric] ?? '',
        notes: draftNotesByMetric[metric] ?? '',
      });

      const res = await readMentorHealth(accessToken, selectedProjectId);
      setMetrics((res.metrics ?? []) as Array<HealthMetric | null>);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save metric');
    } finally {
      setIsSaving((prev) => ({ ...prev, [metric]: false }));
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <Header />
      <main className="flex-1 min-h-0 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
        {!accessToken ? (
          <div className="mx-auto w-full max-w-3xl px-6 py-10">
            <p className="text-bolt-elements-textSecondary">Logga in för att använda Hälsokoll.</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl px-4 py-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-semibold">Hälsokoll</div>
                <div className="mt-1 text-sm text-bolt-elements-textSecondary">En enkel veckokoll baserad på vad du rapporterar.</div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={selectedProjectId ? `/mentor?projectId=${encodeURIComponent(selectedProjectId)}` : '/mentor'}
                  className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm font-semibold"
                >
                  Tillbaka till Mentor
                </a>

                <select
                  className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title ?? 'Untitled project'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
            ) : null}

            {isLoading ? (
              <div className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 text-sm text-bolt-elements-textSecondary">
                Laddar…
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {metricNames.map((name, idx) => {
                  const row = metrics[idx];
                  const status = row?.status ?? 'yellow';

                  return (
                    <div key={name} className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`h-2.5 w-2.5 rounded-full ${statusDotClass(status)}`} />
                          <div className="font-semibold">{name}</div>
                        </div>
                        <div className="text-xs text-bolt-elements-textSecondary">{statusLabel(status)}</div>
                      </div>

                      {!row ? (
                        <div className="mt-2 text-sm text-bolt-elements-textSecondary">Uppdatera dina siffror så jag kan följa hur det går.</div>
                      ) : null}

                      <div className="mt-3 grid gap-2">
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            className={`rounded-lg border px-2 py-1 text-sm ${draftStatusByMetric[name] === 'green' ? 'border-emerald-400/60 bg-emerald-400/10' : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1'}`}
                            onClick={() => setDraftStatusByMetric((p) => ({ ...p, [name]: 'green' }))}
                          >
                            Grönt
                          </button>
                          <button
                            className={`rounded-lg border px-2 py-1 text-sm ${draftStatusByMetric[name] === 'yellow' ? 'border-amber-400/60 bg-amber-400/10' : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1'}`}
                            onClick={() => setDraftStatusByMetric((p) => ({ ...p, [name]: 'yellow' }))}
                          >
                            Gult
                          </button>
                          <button
                            className={`rounded-lg border px-2 py-1 text-sm ${draftStatusByMetric[name] === 'red' ? 'border-red-400/60 bg-red-400/10' : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-1'}`}
                            onClick={() => setDraftStatusByMetric((p) => ({ ...p, [name]: 'red' }))}
                          >
                            Rött
                          </button>
                        </div>

                        <input
                          className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm"
                          placeholder={name === 'Cashflow' ? 'T.ex. runway 6 månader' : 'Kort datapunkt'}
                          value={draftValueByMetric[name] ?? ''}
                          onChange={(e) => setDraftValueByMetric((p) => ({ ...p, [name]: e.target.value }))}
                        />

                        <textarea
                          className="min-h-[72px] w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm"
                          placeholder="Anteckning (kort)"
                          value={draftNotesByMetric[name] ?? ''}
                          onChange={(e) => setDraftNotesByMetric((p) => ({ ...p, [name]: e.target.value }))}
                        />

                        <div className="flex items-center justify-between">
                          <div className="text-xs text-bolt-elements-textSecondary">
                            {row?.recorded_at ? `Senast: ${new Date(row.recorded_at).toLocaleDateString()}` : null}
                          </div>
                          <button
                            className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-sm font-semibold disabled:opacity-60"
                            disabled={Boolean(isSaving[name])}
                            onClick={() => void onSaveMetric(name)}
                          >
                            {isSaving[name] ? 'Sparar…' : 'Spara'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {selectedProject ? (
              <div className="mt-6 text-xs text-bolt-elements-textSecondary">Projekt: {selectedProject.title ?? selectedProject.id}</div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
