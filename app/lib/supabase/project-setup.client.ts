import { webcontainer } from '~/lib/webcontainer';

async function readTextFile(path: string) {
  const wc = await webcontainer;

  try {
    const value = await wc.fs.readFile(path, 'utf-8');
    return String(value);
  } catch {
    return null;
  }
}

async function writeTextFile(path: string, content: string) {
  const wc = await webcontainer;
  await wc.fs.writeFile(path, content);
}

export async function applySupabaseToBuilderProject(config: { url: string; anonKey: string }) {
  const packageJsonRaw = await readTextFile('package.json');

  if (packageJsonRaw) {
    try {
      const parsed = JSON.parse(packageJsonRaw);
      parsed.dependencies = parsed.dependencies ?? {};

      if (!parsed.dependencies['@supabase/supabase-js']) {
        parsed.dependencies['@supabase/supabase-js'] = '^2.57.4';
        await writeTextFile('package.json', `${JSON.stringify(parsed, null, 2)}\n`);
      }
    } catch {
      // ignore malformed package.json
    }
  }

  const envContent = `VITE_SUPABASE_URL=${config.url}\nVITE_SUPABASE_ANON_KEY=${config.anonKey}\n`;
  await writeTextFile('.env.local', envContent);
  await writeTextFile('.env.example', envContent);

  const srcDirExists = await readTextFile('src/main.tsx').then((value) => value !== null);
  if (!srcDirExists) {
    return;
  }

  const supabaseClient = "import { createClient } from '@supabase/supabase-js';\n\nexport const supabase = createClient(\n  import.meta.env.VITE_SUPABASE_URL,\n  import.meta.env.VITE_SUPABASE_ANON_KEY,\n);\n";
  await writeTextFile('src/lib/supabase.ts', supabaseClient);
}
