import type { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import { writeBrainEvent } from '~/lib/brain/events.client';
import { createSnapshot } from '~/lib/projects/api.client';
import { collectTextFilesFromWebContainer } from '~/lib/projects/snapshot.client';
import { organismAccessToken, organismProjectId } from '~/lib/stores/organism';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();
  #autoSaveTimer: number | null = null;
  #autoSaveInFlight: Promise<void> = Promise.resolve();
  #projectAnalysisTimer: number | null = null;
  #projectAnalysisInFlight: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
  }

  #scheduleAutoSave() {
    if (this.#autoSaveTimer !== null) {
      window.clearTimeout(this.#autoSaveTimer);
    }

    this.#autoSaveTimer = window.setTimeout(() => {
      this.#autoSaveTimer = null;
      this.#autoSaveInFlight = this.#autoSaveInFlight
        .then(() => this.#persistProjectSnapshot())
        .catch((error) => {
          logger.error('Failed to auto-save project snapshot\n\n', error);
        });
    }, 750);
  }

  async #persistProjectSnapshot() {
    const projectId = organismProjectId.get();
    const accessToken = organismAccessToken.get();

    if (!projectId || !accessToken) {
      return;
    }

    const files = await collectTextFilesFromWebContainer();

    if (Object.keys(files).length === 0) {
      return;
    }

    await createSnapshot(accessToken, {
      projectId,
      title: null,
      files,
    });
  }

  #isBuildShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      return false;
    }

    const command = action.content.toLowerCase();

    return (
      command.includes('npm run build') ||
      command.includes('pnpm build') ||
      command.includes('pnpm run build') ||
      command.includes('yarn build') ||
      command.includes('bun run build') ||
      command.includes('vite build')
    );
  }

  #scheduleProjectAnalysis() {
    if (this.#projectAnalysisTimer !== null) {
      window.clearTimeout(this.#projectAnalysisTimer);
    }

    this.#projectAnalysisTimer = window.setTimeout(() => {
      this.#projectAnalysisTimer = null;
      this.#projectAnalysisInFlight = this.#projectAnalysisInFlight
        .then(() => this.#analyzeBuiltProject())
        .catch((error) => {
          logger.error('Failed to analyze built project\n\n', error);
        });
    }, 1500);
  }

  async #analyzeBuiltProject() {
    const accessToken = organismAccessToken.get();
    const projectId = organismProjectId.get();

    if (!accessToken || !projectId) {
      return;
    }

    const webcontainer = await this.#webcontainer;

    let htmlContent = '';

    try {
      const rawHtml = await webcontainer.fs.readFile('dist/index.html', 'utf-8');
      htmlContent = String(rawHtml).trim();
    } catch {
      return;
    }

    if (!htmlContent) {
      return;
    }

    const response = await fetch('/api/project-intelligence', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        projectId,
        htmlContent,
      }),
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(json?.error || `[RIDVAN-E2024] Project intelligence request failed (${response.status})`);
    }
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const webcontainer = await this.#webcontainer;

    const process = await webcontainer.spawn('jsh', ['-c', action.content], {
      env: { npm_config_yes: true },
    });

    action.abortSignal.addEventListener('abort', () => {
      process.kill();
    });

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log(data);
        },
      }),
    );

    const exitCode = await process.exit;

    logger.debug(`Process terminated with code ${exitCode}`);

    if (exitCode === 0 && this.#isBuildShellAction(action)) {
      this.#scheduleProjectAnalysis();
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;

    let folder = nodePath.dirname(action.filePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(action.filePath, action.content);

      const projectId = organismProjectId.get();
      const accessToken = organismAccessToken.get();

      if (projectId && accessToken) {
        void writeBrainEvent({
          accessToken,
          projectId,
          type: 'project.files_changed',
          idempotencyKey: `project.files_changed:${projectId}:${action.filePath}:${Date.now()}`,
          payload: {
            file_paths: [action.filePath],
            changed_count: 1,
            trigger: 'builder_action',
          },
        }).catch(() => undefined);
      }

      this.#scheduleAutoSave();

      logger.debug(`File written ${action.filePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
