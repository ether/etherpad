# Admin UI

Vite + React 19 single-page app served at `/admin`. Talks to the backend over
socket.io for the existing settings / plugins / pads pages, and (when
endpoints are added to the OpenAPI spec) over a typed REST client.

## Scripts

| Script               | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `pnpm dev`           | Vite dev server. Expects an etherpad backend on :9001.   |
| `pnpm gen:api`       | Regenerates `src/api/schema.d.ts` from the OpenAPI spec. |
| `pnpm build`         | `gen:api` + `tsc` + `vite build`.                        |
| `pnpm build-copy`    | Same, but writes into `../src/templates/admin`.          |
| `pnpm test`          | Smoke tests for the API client wiring.                   |
| `pnpm lint`          | ESLint.                                                  |

## Typed API client

The admin uses [`openapi-typescript`] to generate types from
`src/node/hooks/express/openapi.ts`, [`openapi-fetch`] for typed requests, and
[`openapi-react-query`] for TanStack Query bindings.

[`openapi-typescript`]: https://github.com/openapi-ts/openapi-typescript
[`openapi-fetch`]: https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch
[`openapi-react-query`]: https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-react-query

### Regenerating the schema

```sh
pnpm --filter admin gen:api
```

This runs `admin/scripts/gen-api.mjs`, which loads
`src/node/hooks/express/openapi.ts`, calls `generateDefinitionForVersion` for
the latest API version, pipes the JSON through `openapi-typescript`, and
writes the result to `admin/src/api/schema.d.ts`. The latest API version
read from the spec is also emitted to `admin/src/api/version.ts` so
`client.ts` can build the right `/api/<version>/` baseUrl. Both generated
files are checked in.

Run `gen:api` after any change to:

- `src/node/hooks/express/openapi.ts`
- `src/node/handler/APIHandler.ts` (changes to `latestApiVersion`)
- the resource definitions referenced by `openapi.ts`

### CI freshness check

`.github/workflows/frontend-admin-tests.yml` runs `pnpm gen:api` and fails the
build if `admin/src/api/schema.d.ts` is out of date. If you see the failure
locally, run `pnpm --filter admin gen:api` and commit the regenerated file.

### Using the client

```tsx
import { $api } from './api/client';

const SettingsPanel = () => {
  const { data } = $api.useQuery('get', '/admin/settings'); // example
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
};
```

The admin endpoints are not yet present in the OpenAPI spec — this client is
in place to support upcoming work (see issue #7638 follow-up). For now, it is
exercised only by the smoke test.
