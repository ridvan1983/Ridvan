import { Navigate } from '@remix-run/react';
import { LoginPage } from '~/components/auth/LoginPage';
import { useAuth } from '~/lib/auth/AuthContext';

export default function LoginRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-bolt-elements-textSecondary">
        Loading authentication...
      </div>
    );
  }

  if (user) {
    return <Navigate to="/chat" replace />;
  }

  return <LoginPage />;
}
