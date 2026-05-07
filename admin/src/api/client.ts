// admin/src/api/client.ts
//
// Typed HTTP client and TanStack Query hooks derived from the generated
// OpenAPI schema. Regenerate the schema with `pnpm --filter admin gen:api`.

import createClient from 'openapi-fetch';
import createQueryHooks from 'openapi-react-query';
import type { paths } from './schema';
import { API_BASE_URL } from './version';

export const fetchClient = createClient<paths>({ baseUrl: API_BASE_URL });
export const $api = createQueryHooks(fetchClient);
