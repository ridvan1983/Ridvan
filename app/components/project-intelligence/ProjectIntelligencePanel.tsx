import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { useAuth } from '~/lib/auth/AuthContext';
import { organismProjectId } from '~/lib/stores/organism';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vertical, setVertical] = useState<VerticalContextPayload | null>(null);
  const [modulesPayload, setModulesPayload] = useState<ModulesPayload | null>(null);
  const [activatingModuleId, setActivatingModuleId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !accessToken || !projectId) {
      return;
    }

    let cancelled = false;

    setLoading(true);
    setError(null);

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

        setError(nextError instanceof Error ? nextError.message : '[RIDVAN-E1252] Failed to load intelligence panel');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, isOpen, projectId]);

  const handleActivate = async (moduleId: string) => {
    if (!accessToken || !projectId) {
      return;
    }

    setActivatingModuleId(moduleId);
    setError(null);

    try {
      await activateModule(accessToken, { moduleId, projectId });
      const nextModules = await readModules(accessToken, projectId);
      setModulesPayload(nextModules);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '[RIDVAN-E1253] Failed to activate module');
    } finally {
      setActivatingModuleId(null);
    }
  };

  return (
    <div
      className={[
        'absolute right-4 top-16 bottom-4 z-20 w-[360px] rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-2xl transition-all duration-200',
        isOpen ? 'translate-x-0 opacity-100 pointer-events-auto' : 'translate-x-8 opacity-0 pointer-events-none',
      ].join(' ')}
    >
      <div className="flex items-center justify-between border-b border-bolt-elements-borderColor px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-bolt-elements-textPrimary">Project Intelligence</div>
          <div className="text-xs text-bolt-elements-textSecondary">Vertikalinsikter och rekommenderade moduler</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundDefault hover:text-bolt-elements-textPrimary"
        >
          Stäng
        </button>
      </div>

      <div className="h-full overflow-y-auto px-4 py-4 pb-12">
        {!projectId ? <div className="rounded-xl border border-bolt-elements-borderColor p-4 text-sm text-bolt-elements-textSecondary">Välj ett projekt för att se intelligence.</div> : null}
        {loading ? <div className="rounded-xl border border-bolt-elements-borderColor p-4 text-sm text-bolt-elements-textSecondary">Laddar intelligence...</div> : null}
        {error ? <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div> : null}

        {!loading && projectId ? (
          <div className="space-y-4">
            <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
              <div className="text-sm font-semibold text-bolt-elements-textPrimary">Vertikal Intelligence</div>
              <div className="mt-3 grid gap-3 rounded-xl bg-bolt-elements-background-depth-1 p-3 text-sm">
                <div>
                  <div className="text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Aktiv vertikal</div>
                  <div className="mt-1 font-medium text-bolt-elements-textPrimary">{formatVertical(vertical?.industryProfile?.normalizedIndustry ?? modulesPayload?.vertical)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-bolt-elements-textSecondary">Geo</div>
                  <div className="mt-1 font-medium text-bolt-elements-textPrimary">{vertical?.geoProfile?.city ?? vertical?.geoProfile?.countryCode ?? 'Unknown'}</div>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-bolt-elements-textPrimary">Moduler</div>
                <div className="text-xs text-bolt-elements-textSecondary">Vertikal + generella moduler</div>
              </div>
              <div className="mt-3 space-y-3">
                {(modulesPayload?.modules ?? []).length === 0 ? (
                  <div className="rounded-xl bg-bolt-elements-background-depth-1 p-3 text-sm text-bolt-elements-textSecondary">Inga moduler tillgängliga för detta projekt ännu.</div>
                ) : (
                  (modulesPayload?.modules ?? []).map((module) => {
                    const isActive = module.status === 'active';
                    const isSuggestedOnly = module.status === 'suggested';
                    return (
                      <div key={module.id} className="rounded-xl bg-bolt-elements-background-depth-1 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-bolt-elements-textPrimary">{module.name}</div>
                            <div className="mt-1 text-xs text-bolt-elements-textSecondary">{module.description ?? 'Ingen beskrivning tillgänglig.'}</div>
                            <div className="mt-2 text-xs text-bolt-elements-textSecondary">
                              {module.priceMonthly === 0 ? 'Gratis' : `${module.priceMonthly} ${module.currency}/mån`}
                            </div>
                          </div>
                          {isActive ? (
                            <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300">Aktiverad</span>
                          ) : isSuggestedOnly ? (
                            <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300">Förslag</span>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}
