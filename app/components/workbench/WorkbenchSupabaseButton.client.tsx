import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { toast } from 'react-toastify';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { useAuth } from '~/lib/auth/AuthContext';
import {
  clearSupabaseProjectConnection,
  createManagedSupabaseProject,
  disconnectSupabase,
  getSupabaseConnectionStatus,
  loadSupabaseProjects,
  setupSupabaseForProject,
  startSupabaseConnect,
  type SupabaseConnectionState,
  type SupabaseManagedProject,
} from '~/lib/supabase/api.client';
import { applySupabaseToBuilderProject } from '~/lib/supabase/project-setup.client';
import { listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';
import { logger } from '~/utils/logger';

export function WorkbenchSupabaseButton() {
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [supabaseState, setSupabaseState] = useState<SupabaseConnectionState | null>(null);
  const [isSupabaseConnected, setIsSupabaseConnected] = useState(false);
  const [isSupabaseConnecting, setIsSupabaseConnecting] = useState(false);
  const [newSupabaseProjectName, setNewSupabaseProjectName] = useState('');
  const [manualAnonKey, setManualAnonKey] = useState('');
  const projectId = searchParams.get('projectId');

  const activeProject = useMemo(() => projects.find((project) => project.id === projectId) ?? null, [projectId, projects]);

  const loadProjectsForContext = useCallback(async () => {
    if (!session?.access_token) {
      setProjects([]);
      return;
    }

    try {
      const nextProjects = await listProjects(session.access_token);
      setProjects(nextProjects);
    } catch (error) {
      logger.error(error);
    }
  }, [session?.access_token]);

  const loadSupabaseState = useCallback(async () => {
    if (!projectId) {
      setIsSupabaseConnected(false);
      setSupabaseState(null);
      return;
    }

    if (!session?.access_token) {
      setIsSupabaseConnected(false);
      setSupabaseState(null);
      return;
    }

    try {
      const status = await getSupabaseConnectionStatus(session.access_token, projectId);

      if (!status.connected) {
        setIsSupabaseConnected(false);
        setSupabaseState(null);
        return;
      }

      const nextState = await loadSupabaseProjects(session.access_token, projectId);
      setIsSupabaseConnected(true);
      setSupabaseState(nextState);
    } catch (error) {
      logger.error(error);
      if (isSupabaseConnected) {
        toast.error('Failed to load Supabase status');
      } else {
        setIsSupabaseConnected(false);
        setSupabaseState(null);
      }
    }
  }, [isSupabaseConnected, projectId, session?.access_token]);

  useEffect(() => {
    void loadProjectsForContext();
  }, [loadProjectsForContext]);

  useEffect(() => {
    void loadSupabaseState();
  }, [loadSupabaseState]);

  useEffect(() => {
    if (activeProject?.title) {
      setNewSupabaseProjectName(`ridvan-${activeProject.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24));
    }
  }, [activeProject?.title]);

  useEffect(() => {
    setManualAnonKey(activeProject?.supabaseAnonKey ?? '');
  }, [activeProject?.supabaseAnonKey]);

  const handleConnectSupabase = useCallback(async () => {
    if (!session?.access_token) {
      toast.error('You need to be logged in');
      return;
    }

    setIsSupabaseConnecting(true);

    try {
      const url = await startSupabaseConnect(session.access_token, {
        projectId,
        returnTo: window.location.href,
      });
      window.location.href = url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to connect Supabase');
    } finally {
      setIsSupabaseConnecting(false);
    }
  }, [projectId, session?.access_token]);

  const handleCreateSupabaseProject = useCallback(async () => {
    if (!session?.access_token || !projectId || !newSupabaseProjectName.trim() || !manualAnonKey.trim()) {
      return;
    }

    try {
      const project = await createManagedSupabaseProject(session.access_token, { name: newSupabaseProjectName.trim() });
      const setup = await setupSupabaseForProject(session.access_token, {
        projectId,
        supabaseProjectId: project.id,
        anonKey: manualAnonKey.trim(),
      });

      if (!setup.projectUrl || !setup.anonKey) {
        throw new Error('Supabase setup returned incomplete credentials');
      }

      await applySupabaseToBuilderProject({ url: setup.projectUrl, anonKey: setup.anonKey });
      await loadSupabaseState();
      await loadProjectsForContext();
      toast.success('Supabase project created and connected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create Supabase project');
    }
  }, [loadProjectsForContext, loadSupabaseState, manualAnonKey, newSupabaseProjectName, projectId, session?.access_token]);

  const handleSelectSupabaseProject = useCallback(
    async (managedProject: SupabaseManagedProject) => {
      if (!session?.access_token || !projectId) {
        return;
      }

      try {
        const setup = await setupSupabaseForProject(session.access_token, {
          projectId,
          supabaseProjectId: managedProject.id,
          anonKey: manualAnonKey.trim(),
        });

        if (!setup.projectUrl || !setup.anonKey) {
          throw new Error('Supabase setup returned incomplete credentials');
        }

        await applySupabaseToBuilderProject({ url: setup.projectUrl, anonKey: setup.anonKey });
        await loadSupabaseState();
        await loadProjectsForContext();
        toast.success('Supabase connected to project');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to connect Supabase project');
      }
    },
    [loadProjectsForContext, loadSupabaseState, manualAnonKey, projectId, session?.access_token],
  );

  const handleDisconnectProjectSupabase = useCallback(async () => {
    if (!session?.access_token || !projectId) {
      return;
    }

    try {
      await clearSupabaseProjectConnection(session.access_token, projectId);
      await loadSupabaseState();
      await loadProjectsForContext();
      toast.success('Supabase disconnected from project');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect Supabase from project');
    }
  }, [loadProjectsForContext, loadSupabaseState, projectId, session?.access_token]);

  const handleDisconnectOauth = useCallback(async () => {
    if (!session?.access_token) {
      return;
    }

    try {
      await disconnectSupabase(session.access_token, projectId);
      setIsSupabaseConnected(false);
      setSupabaseState(null);
      await loadSupabaseState();
      toast.success('Supabase OAuth disconnected');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to disconnect Supabase OAuth');
    }
  }, [loadSupabaseState, session?.access_token]);

  if (!projectId) {
    return null;
  }

  return (
    <>
      <PanelHeaderButton
        className="mr-1 text-sm"
        onClick={() => {
          setIsOpen(true);
          void loadSupabaseState();
        }}
      >
        <div className="i-ph:database" />
        Supabase
        <span className={`ml-1 inline-flex h-2.5 w-2.5 rounded-full ${supabaseState?.projectConnection?.supabase_connected_at ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      </PanelHeaderButton>

      <DialogRoot open={isOpen}>
        <Dialog
          onBackdrop={() => setIsOpen(false)}
          onClose={() => setIsOpen(false)}
        >
          <DialogTitle>Connect Supabase</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4">
              <p>
                {isSupabaseConnected
                  ? 'Supabase is connected for your account. Choose or create a project to attach to this builder project.'
                  : 'Connect your Supabase account to create or attach a database-backed project with one click.'}
              </p>
              <div className="rounded-md border border-bolt-elements-borderColor p-3 text-sm">
                <div><strong>Current builder project:</strong> {activeProject?.title ?? projectId}</div>
                <div><strong>Status:</strong> {supabaseState?.projectConnection?.supabase_connected_at ? 'Connected' : 'Not connected'}</div>
                {supabaseState?.projectConnection?.supabase_project_url ? (
                  <div><strong>URL:</strong> {supabaseState.projectConnection.supabase_project_url}</div>
                ) : null}
              </div>
              {!isSupabaseConnected ? (
                <DialogButton type="primary" onClick={() => void handleConnectSupabase()}>
                  {isSupabaseConnecting ? 'Connecting...' : 'Connect Supabase'}
                </DialogButton>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2 rounded-md border border-bolt-elements-borderColor p-3 text-sm">
                    <div className="font-medium">Supabase anon key</div>
                    <div className="opacity-80">Gå till Supabase Dashboard → ditt projekt → Settings → API → Project API keys → anon public</div>
                    <input
                      className="w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2"
                      value={manualAnonKey}
                      onChange={(event) => setManualAnonKey(event.target.value)}
                      placeholder="eyJhbGciOi..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2"
                      value={newSupabaseProjectName}
                      onChange={(event) => setNewSupabaseProjectName(event.target.value)}
                      placeholder="new-supabase-project"
                    />
                    <DialogButton type="primary" onClick={() => void handleCreateSupabaseProject()}>
                      Create
                    </DialogButton>
                  </div>
                  <div className="max-h-48 overflow-auto rounded-md border border-bolt-elements-borderColor">
                    {(supabaseState?.projects ?? []).map((managedProject) => (
                      <button
                        key={managedProject.id}
                        className="flex w-full items-center justify-between border-b border-bolt-elements-borderColor px-3 py-2 text-left last:border-b-0 hover:bg-bolt-elements-background-depth-3"
                        onClick={() => void handleSelectSupabaseProject(managedProject)}
                        disabled={!manualAnonKey.trim()}
                      >
                        <span>
                          <span className="block font-medium">{managedProject.name}</span>
                          <span className="block text-xs opacity-70">{managedProject.projectUrl}</span>
                        </span>
                        <span className="text-xs uppercase opacity-70">{managedProject.status ?? 'ready'}</span>
                      </button>
                    ))}
                    {(supabaseState?.projects?.length ?? 0) === 0 ? <div className="px-3 py-2 text-sm opacity-70">No Supabase projects yet.</div> : null}
                  </div>
                  <div className="flex gap-2 justify-end">
                    {supabaseState?.projectConnection?.supabase_connected_at ? (
                      <DialogButton type="secondary" onClick={() => void handleDisconnectProjectSupabase()}>
                        Disconnect Project
                      </DialogButton>
                    ) : null}
                    <DialogButton type="secondary" onClick={() => void handleDisconnectOauth()}>
                      Disconnect OAuth
                    </DialogButton>
                  </div>
                </div>
              )}
            </div>
          </DialogDescription>
        </Dialog>
      </DialogRoot>
    </>
  );
}
