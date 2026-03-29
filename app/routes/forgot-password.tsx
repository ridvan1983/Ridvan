import { Link } from '@remix-run/react';
import { useState } from 'react';
import { brand } from '~/config/brand';
import { supabase } from '~/lib/supabase/client';

export default function ForgotPasswordRoute() {
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(true);

    try {
      const redirectTo = `${window.location.origin}/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) {
        throw new Error(`[RIDVAN-E1201] ${error.message}`);
      }

      setSuccessMessage('Password reset email sent. Check your inbox and follow the link to set a new password.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '[RIDVAN-E1202] Failed to send password reset email';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
        <h1 className="text-3xl font-bold text-center text-bolt-elements-textPrimary">{brand.appName}</h1>
        <p className="mt-2 text-center text-bolt-elements-textSecondary">Reset your password</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm mb-1 text-bolt-elements-textSecondary" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
            disabled={isSubmitting}
            className="w-full rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
            style={{
              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
            }}
          >
            {isSubmitting ? 'Sending...' : 'Send reset email'}
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
