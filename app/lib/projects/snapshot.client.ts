import { WORK_DIR } from '~/utils/constants';
import { webcontainer } from '~/lib/webcontainer';
import type { FileMap } from '~/lib/stores/files';

type WebContainerDirEntry = {
  name: string;
  type?: 'file' | 'directory';
};

export function collectTextFiles(files: FileMap): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [fullPath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file') {
      continue;
    }

    if (dirent.isBinary) {
      continue;
    }

    if (!fullPath.startsWith(`${WORK_DIR}/`)) {
      continue;
    }

    const rel = fullPath.slice(`${WORK_DIR}/`.length);

    if (!rel) {
      continue;
    }

    out[rel] = dirent.content;
  }

  return out;
}

async function walkWorkspaceFiles(dir: string, out: Record<string, string>) {
  const wc = await webcontainer;
  let rawEntries: Array<string | WebContainerDirEntry>;

  try {
    rawEntries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<string | WebContainerDirEntry>;
  } catch {
    return;
  }

  for (const entry of rawEntries) {
    const name = typeof entry === 'string' ? entry : entry.name;

    if (!name || name === '.' || name === '..' || name === 'node_modules') {
      continue;
    }

    const fullPath = `${dir}/${name}`.replace(/\/+/g, '/');
    const entryType = typeof entry === 'string' ? undefined : entry.type;

    if (entryType === 'directory') {
      await walkWorkspaceFiles(fullPath, out);
      continue;
    }

    if (entryType === 'file') {
      try {
        const content = await wc.fs.readFile(fullPath, 'utf-8');
        const rel = fullPath.slice(`${WORK_DIR}/`.length);

        if (rel) {
          out[rel] = String(content);
        }
      } catch {
        // ignore binary/unreadable files
      }
      continue;
    }

    try {
      const nested = await wc.fs.readdir(fullPath);

      if (Array.isArray(nested)) {
        await walkWorkspaceFiles(fullPath, out);
        continue;
      }
    } catch {
      try {
        const content = await wc.fs.readFile(fullPath, 'utf-8');
        const rel = fullPath.slice(`${WORK_DIR}/`.length);

        if (rel) {
          out[rel] = String(content);
        }
      } catch {
        // ignore binary/unreadable files
      }
    }
  }
}

export async function collectTextFilesFromWebContainer(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await walkWorkspaceFiles(WORK_DIR, out);
  return out;
}

async function ensureDir(path: string) {
  const idx = path.lastIndexOf('/');
  if (idx <= 0) {
    return;
  }

  const dir = path.slice(0, idx);
  const wc = await webcontainer;

  await wc.fs.mkdir(dir, { recursive: true });
}

async function clearWorkspaceDir(dir: string) {
  const wc = await webcontainer;
  let rawEntries: Array<string | WebContainerDirEntry>;

  try {
    rawEntries = (await wc.fs.readdir(dir, { withFileTypes: true })) as Array<string | WebContainerDirEntry>;
  } catch {
    return;
  }

  for (const entry of rawEntries) {
    const name = typeof entry === 'string' ? entry : entry.name;

    if (!name || name === '.' || name === '..' || name === 'node_modules') {
      continue;
    }

    const fullPath = `${dir}/${name}`.replace(/\/+/g, '/');
    const entryType = typeof entry === 'string' ? undefined : entry.type;

    try {
      if (entryType === 'directory') {
        await wc.fs.rm(fullPath, { recursive: true, force: true });
        continue;
      }

      if (entryType === 'file') {
        await wc.fs.rm(fullPath, { force: true });
        continue;
      }

      await wc.fs.rm(fullPath, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures and continue restoring the latest snapshot
    }
  }
}

export async function restoreSnapshotFiles(files: Record<string, string>) {
  const wc = await webcontainer;

  await clearWorkspaceDir(WORK_DIR);

  for (const [relPath, content] of Object.entries(files)) {
    await ensureDir(relPath);
    await wc.fs.writeFile(relPath, content);
  }
}
