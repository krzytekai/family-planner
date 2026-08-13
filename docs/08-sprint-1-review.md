# Sprint 1 security/deployment review

Reviewed against the Vercel/Supabase deployment model used by the project.

- Keeps Sprint 0 Vercel fix: npm workspaces and Node 22.x.
- Uses the current Vercel Web Handler `fetch` export for `/api/admin/users.ts`.
- Keeps the Supabase secret key server-only.
- RLS remains enabled on all exposed application tables.
- Adds explicit table/column grants instead of relying on implicit privileges.
- Revokes default PUBLIC/anon execution of SECURITY DEFINER helper functions and grants only the intended authenticated entry points.
