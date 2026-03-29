import { useStore } from '@nanostores/react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import { writeBrainEvent } from '~/lib/brain/events.client';
import { collectTextFiles } from '~/lib/projects/snapshot.client';
import { organismAccessToken, organismPreviewReadyAt, organismProjectId } from '~/lib/stores/organism';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import { PortDropdown } from './PortDropdown';

type DeployFile = {
  file: string;
  data: string;
  encoding: 'utf-8' | 'base64';
};

type WebContainerDirEntry = string | { name?: string };

type PublishModalStep = 'publish' | 'done' | 'domain';
type DeployProvider = 'vercel' | 'netlify';
type DeployStage = 'idle' | 'uploading' | 'building' | 'live' | 'error';

type DeployResponse = {
  url?: string;
  error?: string;
  ok?: boolean;
  status?: string;
  provider?: DeployProvider;
  reused?: boolean;
  vercelProjectId?: string | null;
  netlifySiteId?: string | null;
  netlifySiteName?: string | null;
  customDomain?: string | null;
  suggestedSubdomain?: string | null;
};

function slugifyValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function buildStandalonePreviewHtml(doc: Document) {
  const headClone = doc.head.cloneNode(true) as HTMLHeadElement;
  const bodyClone = doc.body.cloneNode(true) as HTMLBodyElement;

  headClone.querySelectorAll('script, base').forEach((node) => node.remove());
  bodyClone.querySelectorAll('script').forEach((node) => node.remove());

  const lang = doc.documentElement.lang || 'en';
  const baseHref = doc.baseURI || doc.URL;
  const bodyAttributes = Array.from(doc.body.attributes)
    .map((attr) => `${attr.name}="${escapeHtml(attr.value)}"`)
    .join(' ');

  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
  <head>
    <meta charset="utf-8" />
    <base href="${escapeHtml(baseHref)}" />
    ${headClone.innerHTML}
  </head>
  <body${bodyAttributes ? ` ${bodyAttributes}` : ''}>
    ${bodyClone.innerHTML}
  </body>
</html>`;
}

async function hashString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

async function readDistFiles(dir = 'dist'): Promise<DeployFile[]> {
  const wc = await webcontainer;
  const out: DeployFile[] = [];

  let rawEntries: WebContainerDirEntry[];

  try {
    rawEntries = (await wc.fs.readdir(dir)) as WebContainerDirEntry[];
  } catch {
    return out;
  }

  for (const entry of rawEntries) {
    const name = typeof entry === 'string' ? entry : entry?.name;

    if (!name) {
      continue;
    }

    const fullPath = `${dir}/${name}`;

    let isDirectory = false;

    try {
      await wc.fs.readdir(fullPath);
      isDirectory = true;
    } catch {
      isDirectory = false;
    }

    if (isDirectory) {
      const nested = await readDistFiles(fullPath);
      out.push(...nested);
      continue;
    }

    try {
      const content = await wc.fs.readFile(fullPath);
      const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content));
      const relativePath = fullPath.replace(/^dist\//, '');
      const isText = /\.(html|css|js|mjs|cjs|json|svg|txt|xml|map)$/i.test(name);

      out.push({
        file: relativePath,
        data: isText ? new TextDecoder().decode(bytes) : bytesToBase64(bytes),
        encoding: isText ? 'utf-8' : 'base64',
      });
    } catch {
      // skip unreadable file
    }
  }

  return out;
}

export const Preview = memo(() => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [isPortDropdownOpen, setIsPortDropdownOpen] = useState(false);
  const hasSelectedPreview = useRef(false);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];

  const [url, setUrl] = useState('');
  const [iframeUrl, setIframeUrl] = useState<string | undefined>();
  const [isPublishing, setIsPublishing] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [vercelProjectId, setVercelProjectId] = useState<string | null>(null);
  const [deployProvider, setDeployProvider] = useState<DeployProvider | null>(null);
  const [deployStage, setDeployStage] = useState<DeployStage>('idle');
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string>('');
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [publishModalStep, setPublishModalStep] = useState<PublishModalStep>('publish');
  const [publishSubdomain, setPublishSubdomain] = useState(() => slugifyValue(document.title || 'ridvan-app'));
  const [publishStatusText, setPublishStatusText] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [domainError, setDomainError] = useState('');
  const [domainSuccess, setDomainSuccess] = useState('');
  const [isConnectingDomain, setIsConnectingDomain] = useState(false);

  const resolvedLiveUrl = customDomain ? `https://${customDomain}` : liveUrl;

  const deployStageLabel =
    deployStage === 'uploading'
      ? 'Uploading'
      : deployStage === 'building'
        ? 'Building'
        : deployStage === 'live'
          ? 'Live'
          : deployStage === 'error'
            ? 'Error'
            : 'Idle';

  const handlePreviewLoad = useCallback(() => {
    const projectId = organismProjectId.get();
    const accessToken = organismAccessToken.get();
    const loadedUrl = iframeRef.current?.src ?? iframeUrl ?? activePreview?.baseUrl ?? null;

    organismPreviewReadyAt.set(Date.now());

    if (!projectId || !accessToken || !loadedUrl) {
      return;
    }

    writeBrainEvent({
      accessToken,
      projectId,
      type: 'project.built',
      idempotencyKey: `project.built:${projectId}:${loadedUrl}`,
      payload: {
        preview_url: loadedUrl,
        port: activePreview?.port ?? null,
      },
    }).catch(() => {});
  }, [activePreview?.baseUrl, activePreview?.port, iframeUrl]);

  useEffect(() => {
    if (!activePreview) {
      setUrl('');
      setIframeUrl(undefined);

      return;
    }

    const { baseUrl } = activePreview;

    setUrl(baseUrl);
    setIframeUrl(baseUrl);
  }, [activePreview, iframeUrl]);

  useEffect(() => {
    const nextSlug = slugifyValue(document.title || 'ridvan-app');

    if (nextSlug) {
      setPublishSubdomain((current) => current || nextSlug);
    }
  }, []);

  const validateUrl = useCallback(
    (value: string) => {
      if (!activePreview) {
        return false;
      }

      const { baseUrl } = activePreview;

      if (value === baseUrl) {
        return true;
      } else if (value.startsWith(baseUrl)) {
        return ['/', '?', '#'].includes(value.charAt(baseUrl.length));
      }

      return false;
    },
    [activePreview],
  );

  const findMinPortIndex = useCallback(
    (minIndex: number, preview: { port: number }, index: number, array: { port: number }[]) => {
      return preview.port < array[minIndex].port ? index : minIndex;
    },
    [],
  );

  // when previews change, display the lowest port if user hasn't selected a preview
  useEffect(() => {
    if (previews.length > 1 && !hasSelectedPreview.current) {
      const minPortIndex = previews.reduce(findMinPortIndex, 0);

      setActivePreviewIndex(minPortIndex);
    }
  }, [previews]);

  const reloadPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const openPreviewInNewTab = async () => {
    if (resolvedLiveUrl) {
      window.open(resolvedLiveUrl, '_blank');
      return;
    }

    const previousModalState = isPublishModalOpen;
    setIsPublishModalOpen(false);

    try {
      await publishPreview();

      const nextLiveUrl = customDomain ? `https://${customDomain}` : liveUrl;

      if (nextLiveUrl) {
        window.open(nextLiveUrl, '_blank');
      }
    } finally {
      setIsPublishModalOpen(previousModalState);
    }
  };

  const openPublishModal = () => {
    setPublishError('');
    setDomainError('');
    setDomainSuccess('');
    setPublishStatusText('');
    setDeployStage(resolvedLiveUrl ? 'live' : 'idle');
    setPublishModalStep(resolvedLiveUrl ? 'done' : 'publish');
    setIsPublishModalOpen(true);
  };

  const openRedeployModal = () => {
    setPublishError('');
    setDomainError('');
    setDomainSuccess('');
    setPublishStatusText('');
    setDeployStage('idle');
    setPublishModalStep('publish');
    setIsPublishModalOpen(true);
  };

  const closePublishModal = () => {
    if (isPublishing || isConnectingDomain) {
      return;
    }

    setIsPublishModalOpen(false);
    setPublishError('');
    setDomainError('');
    setDomainSuccess('');
    setPublishStatusText('');
  };

  const copyLiveUrl = async () => {
    if (!resolvedLiveUrl) {
      return;
    }

    await navigator.clipboard.writeText(resolvedLiveUrl).catch(() => {});
  };

  const deployWithProvider = async (provider: DeployProvider, payload: Record<string, unknown>, accessToken: string) => {
    const endpoint = provider === 'vercel' ? '/api/preview/vercel-deploy' : '/api/preview/deploy';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = (await response.json().catch(() => null)) as DeployResponse | null;

    if (!response.ok) {
      throw new Error(json?.error || `[RIDVAN-E1980] ${provider} deploy failed (${response.status})`);
    }

    return json;
  };

  const publishPreview = async () => {
    const accessToken = organismAccessToken.get();
    const projectId = organismProjectId.get();

    if (!accessToken || !projectId || isPublishing) {
      return;
    }

    setPublishError('');
    setDomainError('');
    setDomainSuccess('');
    setIsPublishing(true);
    setDeployStage('uploading');
    setPublishStatusText('Uploading build assets...');

    try {
      const sourceFiles = collectTextFiles(workbenchStore.files.get());
      const manifest = Object.entries(sourceFiles)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([filePath, content]) => `${filePath}\n${content}`)
        .join('\n---\n');
      const sourceHash = await hashString(manifest);
      const existing = await deployWithProvider('vercel', { projectId, sourceHash }, accessToken).catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error ?? '');

        if (!message.includes('409')) {
          return null;
        }

        return null;
      });

      if (existing?.url) {
        setDeployProvider(existing.provider ?? 'vercel');
        setDeployStage('live');
        setLiveUrl(existing.url);
        setVercelProjectId(existing.vercelProjectId ?? null);
        setCustomDomain(existing.customDomain ?? null);
        setPublishStatusText('Live URL ready.');
        setPublishModalStep('done');
        return;
      }

      workbenchStore.saveAllFiles();

      const wc = await webcontainer;
      const needsInstall = !(await hasNodeModules());
      const buildCommand = needsInstall ? 'npm install && npm run build' : 'npm run build';
      setDeployStage('building');
      setPublishStatusText('Building production bundle...');
      const buildProcess = await wc.spawn('jsh', ['-c', buildCommand], {
        env: { npm_config_yes: 'true' },
      });

      const outputChunks: string[] = [];
      buildProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            outputChunks.push(String(data));
          },
        }),
      ).catch(() => {});

      const exitCode = await buildProcess.exit;

      if (exitCode !== 0) {
        throw new Error(outputChunks.join('').trim() || `[RIDVAN-E1920] Build failed with code ${exitCode}`);
      }

      setDeployStage('uploading');
      setPublishStatusText('Uploading static files to hosting provider...');

      const distFiles = await readDistFiles('dist');

      if (!distFiles.some((file) => file.file === 'index.html')) {
        throw new Error('[RIDVAN-E1921] Build completed but dist/index.html was not found');
      }

      const deployPayload = {
        projectId,
        sourceHash,
        projectName: document.title || 'ridvan-app',
        subdomain: publishSubdomain,
        files: distFiles,
      };

      let deployJson: DeployResponse | null = null;

      try {
        deployJson = await deployWithProvider('vercel', deployPayload, accessToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Vercel deploy failed';
        setPublishStatusText('Vercel unavailable, retrying with Netlify...');
        deployJson = await deployWithProvider('netlify', deployPayload, accessToken).catch(() => {
          throw new Error(message);
        });
      }

      if (!deployJson?.url) {
        throw new Error('[RIDVAN-E1922] Preview deploy returned no live URL');
      }

      setDeployProvider(deployJson.provider ?? 'vercel');
      setDeployStage('live');
      setLiveUrl(deployJson.url);
      setVercelProjectId(deployJson.vercelProjectId ?? null);
      setCustomDomain(deployJson.customDomain ?? null);
      setPublishStatusText('Live URL ready.');
      setPublishModalStep('done');
    } catch (error) {
      setDeployStage('error');
      setPublishError(error instanceof Error ? error.message : 'Publicering misslyckades');
      setPublishStatusText('');
    } finally {
      setIsPublishing(false);
    }
  };

  const addCustomDomain = async () => {
    const accessToken = organismAccessToken.get();
    const projectId = organismProjectId.get();
    const domain = domainInput.trim().toLowerCase();

    if (!accessToken || !projectId || !vercelProjectId || isConnectingDomain) {
      return;
    }

    setDomainError('');
    setDomainSuccess('');
    setIsConnectingDomain(true);

    try {
      const response = await fetch('/api/preview/add-domain', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId,
          domain,
          vercelProjectId,
        }),
      });

      const json = (await response.json().catch(() => null)) as { ok?: boolean; domain?: string; error?: string } | null;

      if (!response.ok || !json?.domain) {
        throw new Error(json?.error || `[RIDVAN-E1950] Domain attach failed (${response.status})`);
      }

      setCustomDomain(json.domain);
      setDomainSuccess(`Domänen ${json.domain} är kopplad. Uppdatera DNS enligt instruktionen nedan.`);
    } catch (error) {
      setDomainError(error instanceof Error ? error.message : 'Kunde inte koppla domänen');
    } finally {
      setIsConnectingDomain(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      {isPortDropdownOpen && (
        <div className="z-iframe-overlay w-full h-full absolute" onClick={() => setIsPortDropdownOpen(false)} />
      )}
      <div className="bg-bolt-elements-background-depth-2 p-2 flex items-center gap-1.5">
        <IconButton icon="i-ph:arrow-clockwise" onClick={reloadPreview} />
        {(iframeUrl ?? activePreview?.baseUrl) && (
          <IconButton
            icon="i-ph:arrow-square-out"
            onClick={() => {
              void openPreviewInNewTab();
            }}
            title="Öppna i ny flik"
          />
        )}
        {(iframeUrl ?? activePreview?.baseUrl) && (
          resolvedLiveUrl ? (
            <>
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700"
                onClick={() => {
                  void openPreviewInNewTab();
                }}
                disabled={isPublishing}
                title="Live →"
              >
                <span className="i-ph:globe text-base" />
                <span>Live →</span>
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
                style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                onClick={openRedeployModal}
                disabled={isPublishing}
                title={isPublishing ? 'Publicerar...' : 'Publicera igen'}
              >
                <span className={`${isPublishing ? 'i-ph:spinner-gap animate-spin' : 'i-ph:arrow-clockwise'} text-base`} />
                <span>{isPublishing ? 'Publicerar...' : 'Publicera igen'}</span>
              </button>
            </>
          ) : (
            <button
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
              onClick={openPublishModal}
              disabled={isPublishing}
              title={isPublishing ? 'Publicerar...' : 'Publicera'}
            >
              <span className={`${isPublishing ? 'i-ph:spinner-gap animate-spin' : 'i-ph:upload-simple'} text-base`} />
              <span>{isPublishing ? 'Publicerar...' : 'Publicera'}</span>
            </button>
          )
        )}
        <div
          className="flex items-center gap-1 flex-grow bg-bolt-elements-preview-addressBar-background border border-bolt-elements-borderColor text-bolt-elements-preview-addressBar-text rounded-full px-3 py-1 text-sm hover:bg-bolt-elements-preview-addressBar-backgroundHover hover:focus-within:bg-bolt-elements-preview-addressBar-backgroundActive focus-within:bg-bolt-elements-preview-addressBar-backgroundActive
        focus-within-border-bolt-elements-borderColorActive focus-within:text-bolt-elements-preview-addressBar-textActive"
        >
          <input
            ref={inputRef}
            className="w-full bg-transparent outline-none"
            type="text"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && validateUrl(url)) {
                setIframeUrl(url);

                if (inputRef.current) {
                  inputRef.current.blur();
                }
              }
            }}
          />
        </div>
        {previews.length > 1 && (
          <PortDropdown
            activePreviewIndex={activePreviewIndex}
            setActivePreviewIndex={setActivePreviewIndex}
            isDropdownOpen={isPortDropdownOpen}
            setHasSelectedPreview={(value) => (hasSelectedPreview.current = value)}
            setIsDropdownOpen={setIsPortDropdownOpen}
            previews={previews}
          />
        )}
      </div>
      {publishError ? (
        <div className="px-3 py-2 text-sm text-red-500 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-1">
          {publishError}
        </div>
      ) : null}
      {isPublishModalOpen ? (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-xl rounded-[12px] border border-black/10 bg-[#F8F7F4] shadow-2xl">
            <button
              className="absolute right-4 top-4 text-xl text-black/50 transition hover:text-black"
              onClick={closePublishModal}
              disabled={isPublishing || isConnectingDomain}
            >
              ×
            </button>
            <div className="p-6 md:p-8">
              {publishModalStep === 'publish' ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-slate-900">Publicera ditt projekt</h2>
                    <p className="text-sm text-slate-600">Välj vilken adress ditt projekt ska få när det går live.</p>
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-white p-4 text-sm text-slate-700 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Provider</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
                        {deployProvider ?? 'Auto'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">Status</span>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-violet-700">
                        {deployStageLabel}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                      <div className={deployStage === 'uploading' || deployStage === 'building' || deployStage === 'live' ? 'font-semibold text-slate-900' : ''}>Uploading</div>
                      <div className={deployStage === 'building' || deployStage === 'live' ? 'font-semibold text-slate-900' : ''}>Building</div>
                      <div className={deployStage === 'live' ? 'font-semibold text-emerald-700' : ''}>Live</div>
                    </div>
                  </div>
                  <div className="text-sm text-slate-600">Vercel används först. Om det misslyckas försöker appen automatiskt via Netlify.</div>
                  {publishStatusText ? <div className="text-sm font-medium text-slate-700">{publishStatusText}</div> : null}
                  {publishError ? <div className="rounded-[8px] bg-red-50 px-4 py-3 text-sm text-red-600">{publishError}</div> : null}
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-sm font-semibold text-white disabled:opacity-70"
                    style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                    onClick={() => {
                      void publishPreview();
                    }}
                    disabled={isPublishing || !publishSubdomain}
                  >
                    <span className={`${isPublishing ? 'i-ph:spinner-gap animate-spin' : 'i-ph:arrow-right'} text-base`} />
                    <span>{isPublishing ? 'Bygger...' : 'Publicera →'}</span>
                  </button>
                </div>
              ) : null}
              {publishModalStep === 'done' ? (
                <div className="space-y-6">
                  <div className="space-y-4 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600">
                      <span className="i-ph:check-circle-fill" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-semibold text-slate-900">Projektet är live! 🎉</h2>
                      <p className="text-sm text-slate-600">Din publika länk är redo att delas.</p>
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="space-y-1">
                        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          {deployProvider ? `${deployProvider} deploy` : 'Live deploy'}
                        </div>
                        <a className="text-sm font-medium text-violet-700 underline break-all" href={resolvedLiveUrl ?? '#'} target="_blank" rel="noreferrer">
                          {resolvedLiveUrl}
                        </a>
                      </div>
                      <button
                        className="rounded-[8px] border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700"
                        onClick={() => {
                          void copyLiveUrl();
                        }}
                      >
                        Kopiera
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      className="inline-flex flex-1 items-center justify-center rounded-[8px] border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                      onClick={() => {
                        setPublishModalStep('domain');
                        setDomainError('');
                        setDomainSuccess('');
                      }}
                    >
                      Koppla egen domän
                    </button>
                    <button
                      className="inline-flex flex-1 items-center justify-center rounded-[8px] px-4 py-3 text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                      onClick={closePublishModal}
                    >
                      Stäng
                    </button>
                  </div>
                </div>
              ) : null}
              {publishModalStep === 'domain' ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-slate-900">Koppla din domän</h2>
                    <p className="text-sm text-slate-600">Anslut din egen domän till ditt publicerade projekt.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Din domän (t.ex. mittforetag.se)</label>
                    <input
                      className="w-full rounded-[8px] border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none"
                      value={domainInput}
                      onChange={(event) => setDomainInput(event.target.value)}
                      placeholder="mittforetag.se"
                    />
                  </div>
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-sm font-semibold text-white disabled:opacity-70"
                    style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                    onClick={() => {
                      void addCustomDomain();
                    }}
                    disabled={isConnectingDomain || !domainInput.trim() || !vercelProjectId}
                  >
                    <span className={`${isConnectingDomain ? 'i-ph:spinner-gap animate-spin' : 'i-ph:globe-hemisphere-west'} text-base`} />
                    <span>{isConnectingDomain ? 'Kopplar...' : 'Koppla'}</span>
                  </button>
                  {domainError ? <div className="rounded-[8px] bg-red-50 px-4 py-3 text-sm text-red-600">{domainError}</div> : null}
                  {domainSuccess ? <div className="rounded-[8px] bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{domainSuccess}</div> : null}
                  <div className="rounded-[12px] border border-slate-200 bg-white p-4">
                    <div className="mb-3 text-sm font-medium text-slate-700">Peka din domän till Ridvan:</div>
                    <div className="grid grid-cols-3 gap-2 text-sm text-slate-700">
                      <div className="font-semibold">Typ</div>
                      <div className="font-semibold">Namn</div>
                      <div className="font-semibold">Värde</div>
                      <div>CNAME</div>
                      <div>@</div>
                      <div>cname.vercel-dns.com</div>
                    </div>
                    <div className="mt-4 text-xs text-slate-500">DNS-ändringar kan ta upp till 24 timmar</div>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      className="inline-flex flex-1 items-center justify-center rounded-[8px] border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700"
                      onClick={() => setPublishModalStep('done')}
                    >
                      Tillbaka
                    </button>
                    <button
                      className="inline-flex flex-1 items-center justify-center rounded-[8px] px-4 py-3 text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #7C3AED, #EC4899)' }}
                      onClick={closePublishModal}
                    >
                      Stäng
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex-1 border-t border-bolt-elements-borderColor">
        {activePreview ? (
          <iframe ref={iframeRef} title="preview" className="border-none w-full h-full bg-white" src={iframeUrl} onLoad={handlePreviewLoad} />
        ) : (
          <div className="flex w-full h-full justify-center items-center bg-white">No preview available</div>
        )}
      </div>
    </div>
  );
});
