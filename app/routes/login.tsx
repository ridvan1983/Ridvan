import { Navigate, useSearchParams } from '@remix-run/react';
import { LoginPage } from '~/components/auth/LoginPage';
import { useAuth } from '~/lib/auth/AuthContext';

export default function LoginRoute() {
  const [searchParams] = useSearchParams();
  const { user, session, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-bolt-elements-textSecondary">
        Loading authentication...
      </div>
    );
  }

  if (user && session) {
    const redirectTarget = searchParams.get('redirect') || '/chat';
    return <Navigate to={redirectTarget} replace />;
  }

  return <LoginPage />;
}
