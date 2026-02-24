import { useNavigate } from '@remix-run/react';
import { useState } from 'react';
import { brand } from '~/config/brand';
import { useAuth } from '~/lib/auth/AuthContext';

type AuthMode = 'login' | 'signup';

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const modeLabel = mode === 'login' ? 'Log in' : 'Sign up';
  const toggleLabel = mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
      }

      navigate('/chat');
    } catch (error) {
      const message = error instanceof Error ? error.message : '[RIDVAN-E008] Authentication failed';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bolt-elements-background-depth-1 px-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
        <h1 className="text-3xl font-bold text-center text-bolt-elements-textPrimary">{brand.appName}</h1>
        <p className="mt-2 text-center text-bolt-elements-textSecondary">{brand.tagline}</p>

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

          <div>
            <label className="block text-sm mb-1 text-bolt-elements-textSecondary" htmlFor="password">
              Password
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

          {errorMessage ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{errorMessage}</div>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg px-4 py-2 font-semibold text-white disabled:opacity-60"
            style={{
              backgroundImage: `linear-gradient(90deg, ${brand.gradient.from}, ${brand.gradient.to})`,
            }}
          >
            {isSubmitting ? `${modeLabel}...` : modeLabel}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          className="mt-4 w-full text-sm text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
        >
          {toggleLabel}
        </button>
      </div>
    </div>
  );
}
