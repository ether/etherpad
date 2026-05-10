# Migration: ueberdb2 → @samtv12345/ueberdb-rs

**Date:** 2026-05-10  
**Author:** SamTV12345  
**Status:** Approved

## Goal

Replace the Node.js `ueberdb2` package with `@samtv12345/ueberdb-rs`, a drop-in Rust-based replacement that provides the same KV abstraction over the same set of database backends via napi-rs native bindings.

## Motivation

`@samtv12345/ueberdb-rs` bundles all database drivers natively in Rust, eliminating the need for 10+ npm driver packages (mysql2, pg, mongodb, redis, etc.) as direct dependencies in etherpad-lite. It exposes an identical API surface with performance benefits from the Rust implementation.

## Approach

Direct swap — replace the import and fix three small API differences inline. No compatibility shim, no feature flags.

## API Differences to Fix

| Location | ueberdb2 | @samtv12345/ueberdb-rs |
|----------|----------|------------------------|
| Constructor | `new Database(type, settings, wrapperSettings, logger)` | `new Database(type, settings, wrapperSettings?)` — drop logger arg |
| Metrics | `db.metrics` (property) | `db.metrics()` (method call) |
| Type export | `DatabaseType` union exported | Not exported — use `string` locally |

## Files Changed

### `src/package.json`
- Remove `ueberdb2`
- Remove direct npm driver packages no longer needed: `@elastic/elasticsearch`, `cassandra-driver`, `mongodb`, `mssql`, `mysql2`, `nano`, `pg`, `redis`, `rethinkdb`, `surrealdb`
- Add `@samtv12345/ueberdb-rs`

### `src/node/db/DB.ts`
- Swap import: `ueberdb2` → `@samtv12345/ueberdb-rs`
- Remove `DatabaseType` from imports
- Drop 4th constructor argument (logger)
- Change `exports.db.metrics` → `exports.db.metrics()` (2 call sites: init loop + prometheus gauge callback)

### `src/node/db/Pad.ts`
- Swap import: `ueberdb2` → `@samtv12345/ueberdb-rs`
- Replace `DatabaseType` usage with `string`

### `src/node/utils/ImportEtherpad.ts`
- Swap import: `ueberdb2` → `@samtv12345/ueberdb-rs`

### `src/node/utils/Settings.ts`
- Replace any `DatabaseType` type annotations with `string`

## No Behaviour Changes

- Same backend names (`dirty`, `rustydb`, `postgres`, `mysql`, `sqlite`, `redis`, `mongodb`, `cassandra`, `elasticsearch`, `mssql`, `couch`, `surrealdb`, `memory`, `postgrespool`)
- Same settings/config format (`dbType`, `dbSettings`, `wrapperSettings`)
- Same default backend (`rustydb`)
- Same key patterns and data layout

## Testing

Run existing test suite after migration. No new tests needed — behaviour is unchanged.
