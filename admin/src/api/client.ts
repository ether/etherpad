// admin/src/api/client.ts
//
// Typed HTTP clients and TanStack Query hooks derived from the generated
// OpenAPI schema. Regenerate the schema with `pnpm --filter admin gen:api`.
//
// The merged spec covers two surfaces with different baseUrls:
//
//   - Public versioned API at /api/<version>/   (paths like /createGroup)
//   - Admin endpoints at root                   (paths like /admin-auth/)
//
// We narrow the generated `paths` interface by URL prefix and create one
// typed client per surface. TypeScript then rejects calling an admin path on
// the public client (or vice versa) at compile time — there is no shared
// client whose runtime baseUrl would silently target the wrong surface.

import createClient from 'openapi-fetch';
import createQueryHooks from 'openapi-react-query';
import type { paths } from './schema';
import { API_BASE_URL } from './version';

type AdminPath = Extract<keyof paths, `/admin${string}`>;
type PublicPath = Exclude<keyof paths, AdminPath>;
type PublicPaths = Pick<paths, PublicPath>;
type AdminPaths = Pick<paths, AdminPath>;

export const fetchClient = createClient<PublicPaths>({ baseUrl: API_BASE_URL });
export const adminFetchClient = createClient<AdminPaths>({ baseUrl: '/' });

export const $api = createQueryHooks(fetchClient);
export const $adminApi = createQueryHooks(adminFetchClient);
