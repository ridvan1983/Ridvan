import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useSearchParams } from '@remix-run/react';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { IconButton } from '~/components/ui/IconButton';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { useAuth } from '~/lib/auth/AuthContext';
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
  | null;

export function Menu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const menuRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { signOut, session } = useAuth();

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
    }
  }, [open]);

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
          </Dialog>
        </DialogRoot>
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
