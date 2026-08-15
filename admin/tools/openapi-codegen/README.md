# @etherpad/openapi-codegen

Private, build-time-only package. It exists purely to pin the TypeScript that
`openapi-typescript` runs against.

`openapi-typescript` builds its output using the TypeScript **compiler API**
(`ts.factory`, `ts.SyntaxKind`, the printer). TypeScript 7 is the native port,
and its main export is only `./lib/version.cjs` — the compiler API isn't there
at all, so the codegen dies with:

```
TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')
```

Its declared peer range is `typescript: ^5.x`, and 7.13.0 is the newest
release, so there is nothing to upgrade to yet.

Pinning it from the workspace root doesn't work: `openapi-typescript` takes
`typescript` as a *peer* dependency, so pnpm satisfies it from whichever
package depends on it. While `admin` both depended on `openapi-typescript`
and declared `typescript: ^7.0.2`, the peer always resolved to 7 — neither
`overrides` nor `packageExtensions` overrides that. Giving the tool its own
package, whose only TypeScript is 6.x, is what makes the peer resolve to a
version with a working compiler API.

The tool only runs at build time to emit `admin/src/api/schema.d.ts`, and that
output is plain text which `tsc` 7 then consumes normally. Nothing here ships.

**Delete this package** once `openapi-typescript` supports the native compiler:
move `openapi-typescript` back into `admin`'s devDependencies and point
`admin/scripts/gen-api.mjs` at it directly.
