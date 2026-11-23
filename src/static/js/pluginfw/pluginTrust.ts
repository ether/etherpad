'use strict';

/**
 * "Official" vs "third-party" for the admin plugin catalog.
 *
 * Anyone can publish an `ep_*` package to npm, and the plugin feed lists
 * every one of them. Etherpad cannot review them all, so the catalog labels
 * the ones the Etherpad project itself publishes as official and everything
 * else as third-party.
 *
 * What makes a plugin official here is npm provenance, not anything the
 * package says about itself. The `repository` field in package.json, the
 * feed's own `official` flag and the npm maintainer list can all be set by
 * whoever publishes the package (`npm owner add` needs no consent from the
 * added user). A provenance attestation cannot: plugins in the ether GitHub
 * org publish from GitHub Actions through npm trusted publishing, and npm
 * only accepts the attestation after checking its Sigstore signature against
 * the GitHub OIDC identity of the workflow that built the package. Core does
 * not re-verify that signature; it trusts registry.npmjs.org over TLS, which
 * is the same trust it already places in the tarball it installs.
 *
 * The attestation is accepted only when it is about this exact package: the
 * in-toto subject must name `<name>@<version>` and carry the same sha512 as
 * the version's `dist.integrity`. The build must come from a repository
 * owned by the ether org, matched both by URL and by the org's numeric
 * GitHub ID, so a renamed or re-registered org name does not inherit trust.
 *
 * Everything in this module is pure so it can be tested without a network.
 */

export const OFFICIAL_GITHUB_ORG = 'ether';
/** Numeric GitHub ID of the ether org (`gh api orgs/ether --jq .id`). */
export const OFFICIAL_GITHUB_OWNER_ID = '181731';
export const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

const officialRepoRe =
    new RegExp(`^https://github\\.com/${OFFICIAL_GITHUB_ORG}/[A-Za-z0-9._-]+$`);

/** True for `https://github.com/ether/<repo>`, nothing looser. */
export const isOfficialRepository = (url: unknown): boolean =>
  typeof url === 'string' && officialRepoRe.test(url);

/** Converts an SRI string (`sha512-<base64>`) to the hex digest in-toto uses. */
export const sha512HexFromIntegrity = (integrity: unknown): string | null => {
  if (typeof integrity !== 'string') return null;
  const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!m) return null;
  const hex = Buffer.from(m[1], 'base64').toString('hex');
  return hex.length === 128 ? hex : null;
};

const npmPurl = (name: string, version: string) =>
  `pkg:npm/${name.replace(/^@/, '%40')}@${version}`;

/**
 * Pulls the source repository out of an npm attestations document
 * (`GET /-/npm/v1/attestations/<name>@<version>`), after checking that the
 * SLSA provenance statement in it is about the given package version.
 *
 * @returns the source repository URL and owner ID, or null when the document
 *   holds no provenance for this exact package.
 */
export const provenanceSource = (
  attestations: unknown,
  pkg: {name: string, version: string, integrity?: unknown},
): {repository: string, ownerId: string | null} | null => {
  const list = (attestations as any)?.attestations;
  if (!Array.isArray(list)) return null;
  const wantDigest = sha512HexFromIntegrity(pkg.integrity);
  if (!wantDigest) return null;
  const wantName = npmPurl(pkg.name, pkg.version);
  for (const att of list) {
    if (!att || att.predicateType !== SLSA_PROVENANCE_V1) continue;
    const payload = att.bundle?.dsseEnvelope?.payload;
    if (typeof payload !== 'string') continue;
    let statement: any;
    try {
      statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    } catch {
      continue;
    }
    if (statement?.predicateType !== SLSA_PROVENANCE_V1) continue;
    const subjects = Array.isArray(statement.subject) ? statement.subject : [];
    const matches = subjects.some((s: any) =>
      s && s.name === wantName && s.digest?.sha512 === wantDigest);
    if (!matches) continue;
    const def = statement.predicate?.buildDefinition;
    const repository = def?.externalParameters?.workflow?.repository;
    if (typeof repository !== 'string') continue;
    const ownerId = def?.internalParameters?.github?.repository_owner_id;
    return {repository, ownerId: typeof ownerId === 'string' ? ownerId : null};
  }
  return null;
};

/** Whether the given provenance makes a package official. */
export const isOfficialProvenance = (
  source: {repository: string, ownerId: string | null} | null,
): boolean => !!source && isOfficialRepository(source.repository) &&
  source.ownerId === OFFICIAL_GITHUB_OWNER_ID;

/**
 * A package that is a name grab or a test upload rather than a plugin: a
 * `0.0.0` pre-release version, or no `repository` at all. Such packages are
 * left out of catalog browsing but are still found by an exact-name search,
 * so a developer can find the package they just published.
 *
 * @param hasRepository `false` only when npm metadata was fetched and has no
 *   repository; `undefined` (lookup failed) does not count as a placeholder.
 */
export const isPlaceholderPackage = (
  version: unknown,
  hasRepository?: boolean,
): boolean => (typeof version === 'string' && /^0\.0\.0(-|$)/.test(version.trim())) ||
  hasRepository === false;

/** Whether npm version metadata names a source repository. */
export const hasRepositoryField = (repository: unknown): boolean => {
  if (typeof repository === 'string') return repository.trim() !== '';
  if (repository && typeof repository === 'object') {
    const url = (repository as any).url;
    return typeof url === 'string' && url.trim() !== '';
  }
  return false;
};

/**
 * `pluginCatalogThirdParty` setting:
 *  - `label` (default): list third-party plugins with a "Third-party" badge;
 *    leave placeholder packages out unless searched for by exact name.
 *  - `hide`: list official plugins only.
 *  - `all`: list everything, placeholders included (still labelled).
 */
export type ThirdPartyMode = 'label' | 'hide' | 'all';
export const THIRD_PARTY_MODES: ReadonlyArray<ThirdPartyMode> = ['label', 'hide', 'all'];

export const normalizeThirdPartyMode = (raw: unknown): ThirdPartyMode => {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return (THIRD_PARTY_MODES as ReadonlyArray<string>).includes(v) ? v as ThirdPartyMode : 'label';
};

/**
 * Whether a classified catalog entry is listed for the given search.
 *
 * @param searchTerm what the admin typed (any case), or empty for browsing.
 */
export const isListedInCatalog = (
  entry: {name: string, official?: boolean, placeholder?: boolean},
  mode: ThirdPartyMode,
  searchTerm = '',
): boolean => {
  if (entry.official) return true;
  if (mode === 'hide') return false;
  if (mode === 'all' || !entry.placeholder) return true;
  return searchTerm.trim().toLowerCase() === entry.name.toLowerCase();
};
