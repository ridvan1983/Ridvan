import { json, type MetaFunction } from '@remix-run/cloudflare';
import { AuthGuard } from '~/components/auth/AuthGuard';
import { Header } from '~/components/header/Header';
import { ProjectsListPage } from '~/components/projects/ProjectsListPage';
import { brand } from '~/config/brand';

export const meta: MetaFunction = () => {
  return [{ title: `Mina projekt — ${brand.appName}` }, { name: 'description', content: 'Lista över dina projekt' }];
};

export async function loader() {
  return json({});
}

export default function ProjectsRoute() {
  return (
    <AuthGuard>
      <div className="flex min-h-screen flex-col bg-bolt-elements-background-depth-1">
        <Header />
        <ProjectsListPage />
      </div>
    </AuthGuard>
  );
}
