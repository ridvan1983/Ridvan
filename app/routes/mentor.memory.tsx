import { json, type MetaFunction } from '@remix-run/cloudflare';
import { Link } from '@remix-run/react';
import { Children, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Header } from '~/components/header/Header';
import { useAuth } from '~/lib/auth/AuthContext';
import { fetchMentorMemory, mutateMentorMemory, type MentorDeepMemoryRow } from '~/lib/mentor/api.client';
import { listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';

export const meta: MetaFunction = () => [{ title: 'Mentor minne — Ridvan' }];

export async function loader() {
  return json({});
}

function MemorySection(props: { title: string; emptyText: string; children: ReactNode }) {
  const hasContent = Children.count(props.children) > 0;
  return (
    <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4">
      <h2 className="text-sm font-semibold text-bolt-elements-textPrimary">{props.title}</h2>
      {hasContent ? <div className="mt-3 space-y-3">{props.children}</div> : null}
      {!hasContent ? <p className="mt-3 text-sm text-bolt-elements-textSecondary">{props.emptyText}</p> : null}
    </section>
  );
}

export default function MentorMemoryPage() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [memory, setMemory] = useState<MentorDeepMemoryRow | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{
    category: 'decisions' | 'pivots' | 'goals' | 'learnings';
    id: string;
    fields: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setProjects([]);
      return;
    }
    listProjects(accessToken)
      .then((items) => {
        setProjects(items);
        if (!selectedProjectId && items.length > 0) {
          setSelectedProjectId(items[0].id);
        }
      })
      .catch(() => setProjects([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const loadMemory = useCallback(async () => {
    if (!accessToken || !selectedProjectId) {
      setMemory(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetchMentorMemory(accessToken, selectedProjectId);
      setMemory(res.memory);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte ladda minnet');
      setMemory(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, selectedProjectId]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  const removeItem = async (id: string) => {
    if (!accessToken || !selectedProjectId) {
      return;
    }
    try {
      const res = await mutateMentorMemory(accessToken, { projectId: selectedProjectId, op: 'remove', id });
      setMemory(res.memory);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort');
    }
  };

  const saveEdit = async () => {
    if (!accessToken || !selectedProjectId || !editing) {
      return;
    }
    try {
      const res = await mutateMentorMemory(accessToken, {
        projectId: selectedProjectId,
        op: 'patch',
        id: editing.id,
        category: editing.category,
        updates: editing.fields,
      });
      setMemory(res.memory);
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kunde inte spara');
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      <Header />
      <main className="flex-1 overflow-auto bg-bolt-elements-background-depth-1 px-4 py-6 text-bolt-elements-textPrimary">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">Mentor — minne</h1>
              <p className="mt-1 text-sm text-bolt-elements-textSecondary">
                Beslut, pivoter, mål och lärdomar som Mentor sparat i brain state för projektet.
              </p>
            </div>
            <Link to="/mentor" className="text-sm font-medium text-violet-700 hover:underline">
              ← Tillbaka till chat
            </Link>
          </div>

          {!accessToken ? (
            <p className="text-sm text-bolt-elements-textSecondary">Logga in för att se minnet.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-bolt-elements-textSecondary" htmlFor="mem-proj">
                  Projekt
                </label>
                <select
                  id="mem-proj"
                  className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2 text-sm"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  disabled={projects.length === 0}
                >
                  {projects.length === 0 ? (
                    <option value="">Inga projekt</option>
                  ) : (
                    projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title ?? 'Utan titel'}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="rounded-lg border border-bolt-elements-borderColor px-3 py-2 text-sm font-medium"
                  onClick={() => void loadMemory()}
                  disabled={loading || !selectedProjectId}
                >
                  {loading ? 'Laddar…' : 'Uppdatera'}
                </button>
              </div>

              {error ? <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-800">{error}</div> : null}

              {memory ? (
                <div className="flex flex-col gap-4">
                  <MemorySection title="Beslut" emptyText="Inga beslut sparade ännu.">
                    {memory.decisions.map((d) => (
                      <div key={d.id} className="rounded-xl border border-bolt-elements-borderColor bg-white/80 p-3 text-sm shadow-sm">
                        <div className="font-medium">{d.decision}</div>
                        <div className="mt-1 text-bolt-elements-textSecondary">Varför: {d.reason}</div>
                        {d.outcome ? <div className="mt-1 text-xs text-bolt-elements-textSecondary">Utfall: {d.outcome}</div> : null}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-xs text-violet-700 underline"
                            onClick={() =>
                              setEditing({
                                category: 'decisions',
                                id: d.id,
                                fields: { decision: d.decision, reason: d.reason, outcome: d.outcome ?? '' },
                              })
                            }
                          >
                            Redigera
                          </button>
                          <button type="button" className="text-xs text-red-600 underline" onClick={() => void removeItem(d.id)}>
                            Ta bort
                          </button>
                        </div>
                      </div>
                    ))}
                  </MemorySection>

                  <MemorySection title="Pivoter" emptyText="Inga pivoter sparade ännu.">
                    {memory.pivots.map((p) => (
                      <div key={p.id} className="rounded-xl border border-bolt-elements-borderColor bg-white/80 p-3 text-sm shadow-sm">
                        <div>
                          {p.from} → {p.to}
                        </div>
                        <div className="mt-1 text-bolt-elements-textSecondary">{p.reason}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-xs text-violet-700 underline"
                            onClick={() =>
                              setEditing({
                                category: 'pivots',
                                id: p.id,
                                fields: { from: p.from, to: p.to, reason: p.reason },
                              })
                            }
                          >
                            Redigera
                          </button>
                          <button type="button" className="text-xs text-red-600 underline" onClick={() => void removeItem(p.id)}>
                            Ta bort
                          </button>
                        </div>
                      </div>
                    ))}
                  </MemorySection>

                  <MemorySection title="Mål" emptyText="Inga mål sparade ännu.">
                    {memory.goals.map((g) => (
                      <div key={g.id} className="rounded-xl border border-bolt-elements-borderColor bg-white/80 p-3 text-sm shadow-sm">
                        <div className="font-medium">{g.goal}</div>
                        <div className="mt-1 text-bolt-elements-textSecondary">
                          Status: {g.status}
                          {g.progress ? ` — ${g.progress}` : ''}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-xs text-violet-700 underline"
                            onClick={() =>
                              setEditing({
                                category: 'goals',
                                id: g.id,
                                fields: { goal: g.goal, status: g.status, progress: g.progress ?? '' },
                              })
                            }
                          >
                            Redigera
                          </button>
                          <button type="button" className="text-xs text-red-600 underline" onClick={() => void removeItem(g.id)}>
                            Ta bort
                          </button>
                        </div>
                      </div>
                    ))}
                  </MemorySection>

                  <MemorySection title="Lärdomar" emptyText="Inga lärdomar sparade ännu.">
                    {memory.learnings.map((l) => (
                      <div key={l.id} className="rounded-xl border border-bolt-elements-borderColor bg-white/80 p-3 text-sm shadow-sm">
                        <div>{l.learning}</div>
                        <div className="mt-1 text-xs text-bolt-elements-textSecondary">Källa: {l.source}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-xs text-violet-700 underline"
                            onClick={() =>
                              setEditing({
                                category: 'learnings',
                                id: l.id,
                                fields: { learning: l.learning, source: l.source },
                              })
                            }
                          >
                            Redigera
                          </button>
                          <button type="button" className="text-xs text-red-600 underline" onClick={() => void removeItem(l.id)}>
                            Ta bort
                          </button>
                        </div>
                      </div>
                    ))}
                  </MemorySection>
                </div>
              ) : null}

              {editing ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                  <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-4 shadow-xl">
                    <div className="text-sm font-semibold">Redigera</div>
                    <div className="mt-3 space-y-2">
                      {Object.entries(editing.fields).map(([k, v]) => (
                        <label key={k} className="block text-xs text-bolt-elements-textSecondary">
                          {k}
                          <textarea
                            className="mt-1 w-full rounded-lg border border-bolt-elements-borderColor bg-white px-2 py-1.5 text-sm text-bolt-elements-textPrimary"
                            rows={k === 'reason' || k === 'learning' ? 3 : 2}
                            value={v}
                            onChange={(e) => setEditing({ ...editing, fields: { ...editing.fields, [k]: e.target.value } })}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button type="button" className="rounded-lg px-3 py-2 text-sm" onClick={() => setEditing(null)}>
                        Avbryt
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white"
                        onClick={() => void saveEdit()}
                      >
                        Spara
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
