import { Link, useNavigate } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { brand } from '~/config/brand';
import { supabase } from '~/lib/supabase/client';

export default function ResetPasswordRoute() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken || !refreshToken) {
      setErrorMessage('[RIDVAN-E1203] Reset link is missing required tokens. Request a new password reset email.');
      return;
    }

    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) {
          setErrorMessage(`[RIDVAN-E1204] ${error.message}`);
          return;
        }

        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
        setIsReady(true);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to initialize password reset session';
        setErrorMessage(`[RIDVAN-E1205] ${message}`);
      });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (password.length < 6) {
      setErrorMessage('[RIDVAN-E1206] Password must be at least 6 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('[RIDVAN-E1207] Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw new Error(`[RIDVAN-E1208] ${error.message}`);
      }

      setSuccessMessage('Your password has been updated. Redirecting to login...');
      window.setTimeout(() => {
        navigate('/login');
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : '[RIDVAN-E1209] Failed to update password';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
        <h1 className="text-3xl font-bold text-center text-bolt-elements-textPrimary">{brand.appName}</h1>
        <p className="mt-2 text-center text-bolt-elements-textSecondary">Set a new password</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm mb-1 text-bolt-elements-textSecondary" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-bolt-elements-textPrimary focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm mb-1 text-bolt-elements-textSecondary" htmlFor="confirmPassword">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 py-2 text-bolt-elements-textPrimary focus:outline-none"
            />
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage}</div>
          ) : null}

          {successMessage ? (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{successMessage}</div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || !isReady}
            className="w-full rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
            style={{
              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
            }}
          >
            {isSubmitting ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <Link
          to="/login"
          className="mt-4 block w-full text-center text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
        >
          Back to login
        </Link>
      </div>
    </div>
  );
}
