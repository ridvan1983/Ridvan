import { Link, useLocation } from '@remix-run/react';

const LINKS: Array<{ to: string; label: string }> = [
  { to: '/admin', label: 'Översikt' },
  { to: '/admin/billing', label: 'Billing' },
  { to: '/admin/errors', label: 'Errors' },
  { to: '/admin/webhooks', label: 'Webhooks' },
  { to: '/admin/jobs', label: 'Jobs' },
];

function linkActive(pathname: string, to: string) {
  if (to === '/admin') {
    return pathname === '/admin';
  }

  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AdminNav() {
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sky-400" aria-label="Admin">
      {LINKS.map((item, index) => (
        <span key={item.to} className="inline-flex items-center gap-x-3">
          {index > 0 ? <span className="text-slate-500 select-none">|</span> : null}
          {linkActive(pathname, item.to) ? (
            <span className="font-medium text-slate-200">{item.label}</span>
          ) : (
            <Link to={item.to} className="hover:underline">
              {item.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
