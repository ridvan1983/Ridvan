import { useStore } from '@nanostores/react';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '~/lib/auth/AuthContext';
import { organismProjectId } from '~/lib/stores/organism';
import type { ProjectIntelligenceDashboardPayload } from '~/lib/project-intelligence/dashboard-types';
import { ProjectIntelligenceDashboard } from './ProjectIntelligenceDashboard';

type VerticalDriver = {
  driver: string;
  why: string;
  lever: string;
  impact: 'revenue' | 'cost' | 'risk';
};

type VerticalPattern = {
  pattern: string;
  symptom: string;
  root_cause: string;
  fast_fix: string;
  impact: 'revenue' | 'cost' | 'risk';
};

type VerticalContextPayload = {
  industryProfile?: {
    normalizedIndustry?: string | null;
  } | null;
  geoProfile?: {
    countryCode?: string | null;
    city?: string | null;
  } | null;
  revenueDrivers?: VerticalDriver[];
  failurePatterns?: VerticalPattern[];
};

type ProjectModule = {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  currency: string;
  vertical: string | null;
  isFree: boolean;
  status: string;
  activatedAt: string | null;
};

type ModulesPayload = {
  projectId: string;
  vertical: string | null;
  modules: ProjectModule[];
};

interface ProjectIntelligencePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

async function readVerticalContext(accessToken: string, projectId: string) {
  const res = await fetch(`/api/vertical/context/${encodeURIComponent(projectId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  const json = (await res.json().catch(() => null)) as { error?: string } | VerticalContextPayload | null;

  if (!res.ok) {
    throw new Error((json as { error?: string } | null)?.error ?? `[RIDVAN-E1249] Failed to load vertical context (${res.status})`);
  }

  return json as VerticalContextPayload;
}

async function readModules(accessToken: string, projectId: string) {
  const res = await fetch(`/api/modules?projectId=${encodeURIComponent(projectId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await res.json().catch(() => null)) as { error?: string } | ModulesPayload | null;

  if (!res.ok) {
    throw new Error((json as { error?: string } | null)?.error ?? `[RIDVAN-E1250] Failed to load modules (${res.status})`);
  }

  return json as ModulesPayload;
}

async function activateModule(accessToken: string, payload: { moduleId: string; projectId: string }) {
  const res = await fetch('/api/modules', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => null)) as { error?: string } | null;

  if (!res.ok) {
    throw new Error(json?.error ?? `[RIDVAN-E1251] Failed to activate module (${res.status})`);
  }
}

function formatVertical(value: string | null | undefined) {
  if (!value) {
    return 'Unknown';
  }

  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function ProjectIntelligencePanel({ isOpen, onClose }: ProjectIntelligencePanelProps) {
  const { session } = useAuth();
  const projectId = useStore(organismProjectId);
  const accessToken = session?.access_token ?? null;
  const [dashLoading, setDashLoading] = useState(false);
  const [dashError, setDashError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<ProjectIntelligenceDashboardPayload | null>(null);
  const [brainMissing, setBrainMissing] = useState(false);
  const [modulesLoading, setModulesLoading] = useState(false);
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [vertical, setVertical] = useState<VerticalContextPayload | null>(null);
  const [modulesPayload, setModulesPayload] = useState<ModulesPayload | null>(null);
  const [activatingModuleId, setActivatingModuleId] = useState<string | null>(null);

  const loadDashboard = useCallback(
    async (refresh?: boolean) => {
      if (!accessToken || !projectId) {
        return;
      }
      setDashLoading(true);
      setDashError(null);
      try {
        const url = `/api/project-intelligence/${encodeURIComponent(projectId)}${refresh ? '?refresh=1' : ''}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
        const json = (await res.json().catch(() => null)) as {
          error?: string;
          dashboard?: ProjectIntelligenceDashboardPayload;
          brainMissing?: boolean;
        } | null;
        if (!res.ok) {
          throw new Error(json?.error ?? 'Kunde inte ladda intelligence');
        }
        setDashboard(json?.dashboard ?? null);
        setBrainMissing(Boolean(json?.brainMissing));
      } catch (e) {
        setDashError(e instanceof Error ? e.message : 'Intelligence misslyckades');
        setDashboard(null);
      } finally {
        setDashLoading(false);
      }
    },
    [accessToken, projectId],
  );

  useEffect(() => {
    if (!isOpen || !accessToken || !projectId) {
      return;
    }

    let cancelled = false;

    void loadDashboard(false);

    setModulesLoading(true);
    setModulesError(null);

    Promise.all([readVerticalContext(accessToken, projectId), readModules(accessToken, projectId)])
      .then(([verticalResult, modulesResult]) => {
        if (cancelled) {
          return;
        }

        setVertical(verticalResult);
        setModulesPayload(modulesResult);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }

        setModulesError(nextError instanceof Error ? nextError.message : '[RIDVAN-E1252] Failed to load modules');
      })
      .finally(() => {
        if (!cancelled) {
          setModulesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, isOpen, projectId, loadDashboard]);

  const handleActivate = async (moduleId: string) => {
    if (!accessToken || !projectId) {
      return;
    }

    setActivatingModuleId(moduleId);
    setModulesError(null);

    try {
      await activateModule(accessToken, { moduleId, projectId });
      const nextModules = await readModules(accessToken, projectId);
      setModulesPayload(nextModules);
    } catch (nextError) {
      setModulesError(nextError instanceof Error ? nextError.message : '[RIDVAN-E1253] Failed to activate module');
    } finally {
      setActivatingModuleId(null);
    }
  };

  return (
    <div
      className={[
        'absolute right-4 top-16 bottom-4 z-20 flex w-[min(100vw-2rem,400px)] flex-col rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl transition-all duration-200',
        isOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-8 opacity-0 pointer-events-none',
      ].join(' ')}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-bolt-elements-borderColor px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Project Intelligence</div>
          <div className="text-xs text-bolt-elements-textSecondary">Affärshälsa, risker &amp; moduler</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundDefault hover:text-bolt-elements-textPrimary"
        >
          Stäng
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-16">
        {!projectId ? (
          <div className="rounded-xl border border-bolt-elements-borderColor p-4 text-sm text-bolt-elements-textSecondary">
            Välj ett projekt för att se intelligence.
          </div>
        ) : (
          <>
            <ProjectIntelligenceDashboard
              projectId={projectId}
              dashboard={dashboard}
              loading={dashLoading}
              error={dashError}
              brainMissing={brainMissing}
              onRefresh={() => void loadDashboard(true)}
            />

            <section className="mt-6 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
              <div className="text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Snabb kontext</div>
              <div className="mt-2 grid gap-2 text-sm">
                <div>
                  <span className="text-bolt-elements-textSecondary">Vertikal: </span>
                  <span className="font-medium text-bolt-elements-textPrimary">
                    {formatVertical(vertical?.industryProfile?.normalizedIndustry ?? modulesPayload?.vertical)}
                  </span>
                </div>
                <div>
                  <span className="text-bolt-elements-textSecondary">Geo: </span>
                  <span className="font-medium text-bolt-elements-textPrimary">
                    {vertical?.geoProfile?.city ?? vertical?.geoProfile?.countryCode ?? '—'}
                  </span>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-bolt-elements-textPrimary">Moduler</div>
                <div className="text-xs text-bolt-elements-textSecondary">Rekommenderade</div>
              </div>
              {modulesLoading ? (
                <div className="mt-3 text-sm text-bolt-elements-textSecondary">Laddar moduler…</div>
              ) : null}
              {modulesError ? <div className="mt-3 text-sm text-rose-300">{modulesError}</div> : null}
              <div className="mt-3 space-y-3">
                {(modulesPayload?.modules ?? []).length === 0 && !modulesLoading ? (
                  <div className="rounded-xl bg-bolt-elements-background-depth-1 p-3 text-sm text-bolt-elements-textSecondary">
                    Inga moduler tillgängliga ännu.
                  </div>
                ) : (
                  (modulesPayload?.modules ?? []).map((module) => {
                    const isActive = module.status === 'active';
                    const isSuggestedOnly = module.status === 'suggested';
                    return (
                      <div key={module.id} className="rounded-xl bg-bolt-elements-background-depth-1 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-bolt-elements-textPrimary">{module.name}</div>
                            <div className="mt-1 text-xs text-bolt-elements-textSecondary">
                              {module.description ?? 'Ingen beskrivning tillgänglig.'}
                            </div>
                            <div className="mt-2 text-xs text-bolt-elements-textSecondary">
                              {module.priceMonthly === 0 ? 'Gratis' : `${module.priceMonthly} ${module.currency}/mån`}
                            </div>
                          </div>
                          {isActive ? (
                            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
                              Aktiverad
                            </span>
                          ) : isSuggestedOnly ? (
                            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">
                              Förslag
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleActivate(module.id)}
                              disabled={activatingModuleId === module.id}
                              className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {activatingModuleId === module.id ? 'Aktiverar...' : 'Aktivera gratis'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
