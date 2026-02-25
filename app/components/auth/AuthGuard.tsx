import { useLocation, useNavigate } from '@remix-run/react';
import { useEffect } from 'react';
import { useAuth } from '~/lib/auth/AuthContext';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, session, loading } = useAuth();

  console.log('[RIDVAN DEBUG] AuthGuard:', { loading, user: !!user, session: !!session });

  useEffect(() => {
    if (!loading && (!user || !session)) {
      const redirectTarget = `${location.pathname}${location.search}`;
      navigate(`/login?redirect=${encodeURIComponent(redirectTarget)}`, { replace: true });
    }
  }, [loading, location.pathname, location.search, navigate, session, user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-bolt-elements-textSecondary">
        Loading authentication...
      </div>
    );
  }

  if (!user || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center text-bolt-elements-textSecondary">
        Redirecting to login...
      </div>
    );
  }

  return <>{children}</>;
}
