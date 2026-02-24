import { useEffect, useState } from 'react';
import { useAuth } from '~/lib/auth/AuthContext';

interface CreditsResponse {
  plan: string;
  credits: number;
  status: string;
}

export default function CreditDisplay() {
  const { session } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!session?.access_token) {
      return;
    }

    let isDisposed = false;

    const fetchCredits = async () => {
      setLoading(true);

      try {
        const response = await fetch('/api/credits', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch credits');
        }

        const payload = (await response.json()) as CreditsResponse;

        if (!isDisposed) {
          setCredits(payload.credits);
          setHasError(false);
        }
      } catch {
        if (!isDisposed) {
          setHasError(true);
          setCredits(null);
        }
      } finally {
        if (!isDisposed) {
          setLoading(false);
        }
      }
    };

    const onFocus = () => {
      fetchCredits();
    };

    fetchCredits();
    window.addEventListener('focus', onFocus);

    return () => {
      isDisposed = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [session?.access_token]);

  if (!session || hasError) {
    return null;
  }

  return (
    <span className="text-xs text-bolt-elements-textSecondary whitespace-nowrap" title="Remaining build credits">
      {loading ? '...' : `⚡ ${credits ?? 0} builds left`}
    </span>
  );
}
