import { json, type MetaFunction } from '@remix-run/cloudflare';
import { Header } from '~/components/header/Header';

export const meta: MetaFunction = () => {
  return [{ title: 'Profile — Ridvan' }];
};

export async function loader() {
  return json({});
}

export default function ProfileRoute() {
  return (
    <div className="flex flex-col h-full w-full">
      <Header />
      <main className="flex-1 min-h-0 bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-3xl font-bold">Profile</h1>
        </div>
      </main>
    </div>
  );
}
