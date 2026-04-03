import { Outlet } from '@remix-run/react';

/**
 * Parent layout for all /admin/* routes. Child routes render via <Outlet />.
 * Without this outlet, Remix only rendered this file and ignored admin.billing, admin.errors, etc.
 */
export default function AdminLayout() {
  return <Outlet />;
}
