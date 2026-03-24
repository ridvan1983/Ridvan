import type { WebContainerProcess } from '@webcontainer/api';
import { webcontainer } from '~/lib/webcontainer';

let starting = false;
let devProcess: WebContainerProcess | null = null;

async function fileExists(path: string) {
  const wc = await webcontainer;

  try {
    await wc.fs.readFile(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

async function hasNodeModules() {
  const wc = await webcontainer;

  try {
    const list = await wc.fs.readdir('node_modules');
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}

export async function ensurePreviewRunning() {
  if (starting || devProcess) {
    return;
  }

  const hasPkg = await fileExists('package.json');
  if (!hasPkg) {
    return;
  }

  starting = true;

  try {
    const wc = await webcontainer;
    const needsInstall = !(await hasNodeModules());

    const command = needsInstall ? 'npm install && npm run dev -- --host 0.0.0.0' : 'npm run dev -- --host 0.0.0.0';

    devProcess = await wc.spawn('jsh', ['-c', command], {
      env: { npm_config_yes: 'true' },
    });

    devProcess.output.pipeTo(
      new WritableStream({
        write(data) {
          // Intentionally minimal to avoid flooding UI.
          console.log(data);
        },
      }),
    );

    // If process exits, allow restarts.
    devProcess.exit
      .then(() => {
        devProcess = null;
      })
      .catch(() => {
        devProcess = null;
      });
  } finally {
    starting = false;
  }
}
