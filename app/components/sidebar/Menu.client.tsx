import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useSearchParams } from '@remix-run/react';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { useAuth } from '~/lib/auth/AuthContext';
import {
  clearSupabaseProjectConnection,
  createManagedSupabaseProject,
  disconnectSupabase,
  loadSupabaseProjects,
  setupSupabaseForProject,
  startSupabaseConnect,
  type SupabaseConnectionState,
  type SupabaseManagedProject,
} from '~/lib/supabase/api.client';
import { applySupabaseToBuilderProject } from '~/lib/supabase/project-setup.client';
import { chatId } from '~/lib/persistence';
import { deleteProject, listProjects } from '~/lib/projects/api.client';
import type { Project } from '~/lib/projects/types';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-150px',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent =
  | { type: 'deleteProject'; project: Project }
  | { type: 'supabase' }
  | null;

export function Menu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const menuRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [supabaseState, setSupabaseState] = useState<SupabaseConnectionState | null>(null);
  const [isSupabaseLoading, setIsSupabaseLoading] = useState(false);
  const [isSupabaseConnecting, setIsSupabaseConnecting] = useState(false);
  const [newSupabaseProjectName, setNewSupabaseProjectName] = useState('');
  const [manualAnonKey, setManualAnonKey] = useState('');
  const projectId = searchParams.get('projectId');
  const { signOut, session } = useAuth();

  const activeProject = projects.find((project) => project.id === projectId) ?? null;

  const loadSupabaseState = useCallback(async () => {
    if (!projectId) {
      setSupabaseState(null);
      return;
    }

    if (!session?.access_token) {
      setSupabaseState(null);
      return;
    }

    setIsSupabaseLoading(true);

    try {
      const next = await loadSupabaseProjects(session.access_token, projectId);
      setSupabaseState(next);
    } catch (error) {
      logger.error(error);
      toast.error('Failed to load Supabase status');
    } finally {
      setIsSupabaseLoading(false);
    }
  }, [projectId, session?.access_token]);

  const loadProjects = useCallback(() => {
    if (!session?.access_token) {
      setProjects([]);
      return;
    }

    listProjects(session.access_token)
      .then(setProjects)
      .catch((error) => {
        logger.error(error);
        toast.error('Failed to load projects');
      });
  }, [session?.access_token]);

  const deleteSupabaseProject = useCallback(
    async (event: React.UIEvent, project: Project) => {
      event.preventDefault();

      if (!session?.access_token) {
        toast.error('You need to be logged in');
        return;
      }

      try {
        await deleteProject(session.access_token, project.id);
        loadProjects();

        if (window.location.pathname === `/chat/${project.id}`) {
          window.location.pathname = '/';
        }
      } catch (error) {
        toast.error('Failed to delete project');
        logger.error(error);
      }
    },
    [session?.access_token, loadProjects],
  );

  const closeDialog = () => {
    setDialogContent(null);
  };

  const handleSignOut = async () => {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);

    try {
      await signOut();
      window.location.href = '/login';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      toast.error(message);
      logger.error(error);
      setIsSigningOut(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadProjects();
      loadSupabaseState();
    }
  }, [open, loadSupabaseState]);

   useEffect(() => {
     if (searchParams.get('supabase') === 'connected') {
       void loadSupabaseState();
       toast.success('Supabase connected');
     }
   }, [loadSupabaseState, searchParams]);

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
       toast.success('Supabase project created and connected');
     } catch (error) {
       toast.error(error instanceof Error ? error.message : 'Failed to create Supabase project');
     }
   }, [loadSupabaseState, manualAnonKey, newSupabaseProjectName, projectId, session?.access_token]);

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
         toast.success('Supabase connected to project');
       } catch (error) {
         toast.error(error instanceof Error ? error.message : 'Failed to connect Supabase project');
       }
     },
     [loadSupabaseState, manualAnonKey, projectId, session?.access_token],
   );

   const handleDisconnectProjectSupabase = useCallback(async () => {
     if (!session?.access_token || !projectId) {
       return;
     }

     try {
       await clearSupabaseProjectConnection(session.access_token, projectId);
       await loadSupabaseState();
       toast.success('Supabase disconnected from project');
     } catch (error) {
       toast.error(error instanceof Error ? error.message : 'Failed to disconnect Supabase from project');
     }
   }, [loadSupabaseState, projectId, session?.access_token]);

   const handleDisconnectOauth = useCallback(async () => {
     if (!session?.access_token) {
       return;
     }

     try {
       await disconnectSupabase(session.access_token);
       await loadSupabaseState();
       toast.success('Supabase OAuth disconnected');
     } catch (error) {
       toast.error(error instanceof Error ? error.message : 'Failed to disconnect Supabase OAuth');
     }
   }, [loadSupabaseState, session?.access_token]);

  useEffect(() => {
    const shouldOpen = searchParams.get('openMenu') === '1';

    if (!shouldOpen) {
      return;
    }

    setOpen(true);

    // Clear the flag to avoid re-opening on subsequent navigations.
    const next = new URLSearchParams(searchParams);
    next.delete('openMenu');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const enterThreshold = 40;
    const exitThreshold = 40;

    function onMouseMove(event: MouseEvent) {
      if (event.pageX < enterThreshold) {
        setOpen(true);
      }

      if (menuRef.current && event.clientX > menuRef.current.getBoundingClientRect().right + exitThreshold) {
        setOpen(false);
      }
    }

    window.addEventListener('mousemove', onMouseMove);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <motion.div
      ref={menuRef}
      initial="closed"
      animate={open ? 'open' : 'closed'}
      variants={menuVariants}
      className="flex flex-col side-menu fixed top-0 w-[350px] h-full bg-bolt-elements-background-depth-2 border-r rounded-r-3xl border-bolt-elements-borderColor z-sidebar shadow-xl shadow-bolt-elements-sidebar-dropdownShadow text-sm"
    >
      <div className="flex items-center h-[var(--header-height)]">{/* Placeholder */}</div>
      <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
        <div className="p-4">
          <a
            href="/"
            className="flex gap-2 items-center bg-bolt-elements-sidebar-buttonBackgroundDefault text-bolt-elements-sidebar-buttonText hover:bg-bolt-elements-sidebar-buttonBackgroundHover rounded-md p-2 transition-theme"
          >
            <span className="inline-block i-ph:chat-circle-text scale-110" />
            Start new chat
          </a>
        </div>
        <div className="text-bolt-elements-textPrimary font-medium pl-6 pr-5 my-2">My Projects</div>
        <div className="pl-4 pr-5 pb-3">
          {projects.length === 0 && (
            <div className="pl-2 text-bolt-elements-textTertiary">No projects yet</div>
          )}
          {projects.slice(0, 20).map((p) => (
            <div key={p.id} className="group flex items-center gap-1 rounded-md hover:bg-bolt-elements-background-depth-3 px-1">
              <a
                href={`/chat?projectId=${encodeURIComponent(p.id)}`}
                className="flex-1 rounded-md text-bolt-elements-textSecondary group-hover:text-bolt-elements-textPrimary overflow-hidden px-1 py-1 truncate"
                title={p.title ?? p.id}
              >
                {p.title ?? 'Untitled project'}
              </a>
              <IconButton
                title="Delete project"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(event) => {
                  event.preventDefault();
                  setDialogContent({ type: 'deleteProject', project: p });
                }}
              >
                <span className="i-ph:trash-bold" />
              </IconButton>
            </div>
          ))}
        </div>
        <div className="flex-1" />
        <DialogRoot open={dialogContent !== null}>
          <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
            {dialogContent?.type === 'deleteProject' && (
              <>
                <DialogTitle>Delete Project?</DialogTitle>
                <DialogDescription asChild>
                  <div>
                    <p>
                      You are about to delete <strong>{dialogContent.project.title ?? dialogContent.project.id}</strong>.
                    </p>
                    <p className="mt-1">This will delete all snapshots and chat sessions for this project.</p>
                  </div>
                </DialogDescription>
                <div className="px-5 pb-4 bg-bolt-elements-background-depth-2 flex gap-2 justify-end">
                  <DialogButton type="secondary" onClick={closeDialog}>
                    Cancel
                  </DialogButton>
                  <DialogButton
                    type="danger"
                    onClick={(event) => {
                      deleteSupabaseProject(event, dialogContent.project);
                      closeDialog();
                    }}
                  >
                    Delete
                  </DialogButton>
                </div>
              </>
            )}
            {dialogContent?.type === 'supabase' && (
              <>
                <DialogTitle>Connect Supabase</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-4">
                    <p>
                      {supabaseState?.connected
                        ? 'Supabase is connected for your account. Choose or create a project to attach to this builder project.'
                        : 'Connect your Supabase account to create or attach a database-backed project with one click.'}
                    </p>
                    <div className="rounded-md border border-bolt-elements-borderColor p-3 text-sm">
                      <div><strong>Current builder project:</strong> {activeProject?.title ?? projectId ?? 'No active project'}</div>
                      <div><strong>Status:</strong> {supabaseState?.projectConnection?.supabase_connected_at ? 'Connected' : 'Not connected'}</div>
                      {supabaseState?.projectConnection?.supabase_project_url ? (
                        <div><strong>URL:</strong> {supabaseState.projectConnection.supabase_project_url}</div>
                      ) : null}
                    </div>
                    {!supabaseState?.connected ? (
                      <DialogButton type="primary" onClick={() => void handleConnectSupabase()}>
                        {isSupabaseConnecting ? 'Connecting...' : 'Connect Supabase'}
                      </DialogButton>
                    ) : (
                      <div className="space-y-3">
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
                          {(supabaseState.projects ?? []).map((managedProject) => (
                            <button
                              key={managedProject.id}
                              className="flex w-full items-center justify-between border-b border-bolt-elements-borderColor px-3 py-2 text-left last:border-b-0 hover:bg-bolt-elements-background-depth-3"
                              onClick={() => void handleSelectSupabaseProject(managedProject)}
                            >
                              <span>
                                <span className="block font-medium">{managedProject.name}</span>
                                <span className="block text-xs opacity-70">{managedProject.projectUrl}</span>
                              </span>
                              <span className="text-xs uppercase opacity-70">{managedProject.status ?? 'ready'}</span>
                            </button>
                          ))}
                          {supabaseState.projects.length === 0 ? <div className="px-3 py-2 text-sm opacity-70">No Supabase projects yet.</div> : null}
                        </div>
                        <div className="flex gap-2 justify-end">
                          {supabaseState.projectConnection?.supabase_connected_at ? (
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
              </>
            )}
          </Dialog>
        </DialogRoot>
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => {
              setDialogContent({ type: 'supabase' });
              void loadSupabaseState();
            }}
            className="flex w-full items-center justify-between rounded-md border border-bolt-elements-borderColor bg-bolt-elements-sidebar-buttonBackgroundDefault px-3 py-2 text-sm text-bolt-elements-sidebar-buttonText hover:bg-bolt-elements-sidebar-buttonBackgroundHover transition-theme"
          >
            <span className="inline-flex items-center gap-2">
              <span className="i-ph:database" />
              Connect Supabase
            </span>
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${supabaseState?.projectConnection?.supabase_connected_at ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          </button>
          {supabaseState?.projectConnection?.supabase_project_url ? (
            <div className="mt-2 px-1 text-xs text-bolt-elements-textTertiary break-all">{supabaseState.projectConnection.supabase_project_url}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 border-t border-bolt-elements-borderColor p-4">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-bolt-elements-sidebar-buttonText bg-bolt-elements-sidebar-buttonBackgroundDefault hover:bg-bolt-elements-sidebar-buttonBackgroundHover transition-theme disabled:opacity-60"
          >
            <span className="i-ph:sign-out-bold" />
            {isSigningOut ? 'Logging out...' : 'Log out'}
          </button>
          <ThemeSwitch className="ml-auto" />
        </div>
      </div>
    </motion.div>
  );
}
