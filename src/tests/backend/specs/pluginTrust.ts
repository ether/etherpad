'use strict';

import {strict as assert} from 'assert';
import {
  hasRepositoryField,
  isListedInCatalog,
  isOfficialProvenance,
  isOfficialRepository,
  isPlaceholderPackage,
  normalizeThirdPartyMode,
  OFFICIAL_GITHUB_OWNER_ID,
  provenanceSource,
  sha512HexFromIntegrity,
  SLSA_PROVENANCE_V1,
} from '../../../static/js/pluginfw/pluginTrust';

// "Official" in the admin plugin catalog must not be something a publisher
// can claim for themselves. These tests pin the classification: only an npm
// provenance attestation for the exact package version, built in a
// repository owned by the ether GitHub org, makes a plugin official.

// Real values from ep_align@11.0.58 on registry.npmjs.org.
const INTEGRITY =
    'sha512-gaS0jGRGYJdYBAU3cc0M2ah6tTUjmF/L3BYRPsWSrNDdC+VOl9UCSd9qSvdWOowXW4jHDtGUVUZTmhH/sXcb8w==';
const DIGEST = '81a4b48c644660975804053771cd0cd9a87ab53523985fcbdc16113ec592acd0' +
               'dd0be54e97d50249df6a4af7563a8c175b88c70ed1945546539a11ffb1771bf3';

const makeAttestations = ({
  name = 'ep_align',
  version = '11.0.58',
  digest = DIGEST,
  repository = 'https://github.com/ether/ep_align',
  ownerId = OFFICIAL_GITHUB_OWNER_ID,
  predicateType = SLSA_PROVENANCE_V1,
}: Partial<Record<'name' | 'version' | 'digest' | 'repository' | 'ownerId' | 'predicateType',
    string>> = {}) => {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{name: `pkg:npm/${name}@${version}`, digest: {sha512: digest}}],
    predicateType,
    predicate: {
      buildDefinition: {
        externalParameters: {workflow: {repository, ref: 'refs/heads/main'}},
        internalParameters: {github: {repository_owner_id: ownerId}},
      },
    },
  };
  return {
    attestations: [
      {predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1',
        bundle: {dsseEnvelope: {payload: Buffer.from('{}').toString('base64')}}},
      {predicateType,
        bundle: {dsseEnvelope: {payload: Buffer.from(JSON.stringify(statement)).toString('base64')}}},
    ],
  };
};

describe(__filename, function () {
  const pkg = {name: 'ep_align', version: '11.0.58', integrity: INTEGRITY};

  describe('isOfficialRepository', function () {
    it('accepts a repository in the ether org', function () {
      assert.equal(isOfficialRepository('https://github.com/ether/ep_align'), true);
    });
    for (const url of [
      'https://github.com/etherx/ep_align',
      'https://github.com/ether/ep_align/../../evil/x',
      'https://github.com/ether/ep_align.git?x=https://github.com/ether/',
      'https://gitlab.com/ether/ep_align',
      'git+https://github.com/ether/ep_align.git',
      'https://github.com/ether',
      'https://github.com/nx-zd/ep_nxs65012',
      undefined,
    ]) {
      it(`rejects ${url}`, function () {
        assert.equal(isOfficialRepository(url), false);
      });
    }
  });

  describe('sha512HexFromIntegrity', function () {
    it('converts an SRI hash to the hex digest in-toto uses', function () {
      assert.equal(sha512HexFromIntegrity(INTEGRITY), DIGEST);
    });
    it('rejects anything that is not sha512', function () {
      assert.equal(sha512HexFromIntegrity('sha1-abc'), null);
      assert.equal(sha512HexFromIntegrity(undefined), null);
    });
  });

  describe('provenanceSource / isOfficialProvenance', function () {
    it('treats a matching ether provenance attestation as official', function () {
      const source = provenanceSource(makeAttestations(), pkg);
      assert.deepEqual(source,
          {repository: 'https://github.com/ether/ep_align', ownerId: OFFICIAL_GITHUB_OWNER_ID});
      assert.equal(isOfficialProvenance(source), true);
    });

    it('is third-party when the package has no provenance at all', function () {
      assert.equal(provenanceSource(undefined, pkg), null);
      assert.equal(provenanceSource({attestations: []}, pkg), null);
      assert.equal(isOfficialProvenance(null), false);
    });

    it('is third-party when the build came from another org', function () {
      const source = provenanceSource(
          makeAttestations({repository: 'https://github.com/nx-zd/ep_align'}), pkg);
      assert.equal(isOfficialProvenance(source), false);
    });

    it('is third-party when the repo URL says ether but the owner ID does not', function () {
      // A re-registered or renamed "ether" org would carry a different ID.
      const source = provenanceSource(makeAttestations({ownerId: '999'}), pkg);
      assert.equal(isOfficialProvenance(source), false);
    });

    it('ignores an attestation copied from another package', function () {
      assert.equal(provenanceSource(makeAttestations(),
          {...pkg, name: 'ep_nxs65012'}), null);
    });

    it('ignores an attestation for another version', function () {
      assert.equal(provenanceSource(makeAttestations(), {...pkg, version: '11.0.59'}), null);
    });

    it('ignores an attestation whose digest does not match the tarball', function () {
      assert.equal(provenanceSource(makeAttestations({digest: 'ab'.repeat(64)}), pkg), null);
      assert.equal(provenanceSource(makeAttestations(), {...pkg, integrity: undefined}), null);
    });

    it('ignores attestations that are not SLSA provenance', function () {
      assert.equal(provenanceSource(
          makeAttestations({predicateType: 'https://example.com/other'}), pkg), null);
    });

    it('survives a garbage payload', function () {
      assert.equal(provenanceSource({attestations: [
        {predicateType: SLSA_PROVENANCE_V1, bundle: {dsseEnvelope: {payload: '!!!'}}},
      ]}, pkg), null);
    });
  });

  describe('isPlaceholderPackage', function () {
    it('flags 0.0.0 pre-release versions', function () {
      assert.equal(isPlaceholderPackage('0.0.0-stage'), true);
      assert.equal(isPlaceholderPackage('0.0.0'), true);
    });
    it('flags a package npm shows without a repository', function () {
      assert.equal(isPlaceholderPackage('1.2.3', false), true);
    });
    it('does not flag a real release, or one whose metadata is unknown', function () {
      assert.equal(isPlaceholderPackage('0.0.1', true), false);
      assert.equal(isPlaceholderPackage('0.0.10'), false);
      assert.equal(isPlaceholderPackage('1.2.3', undefined), false);
    });
  });

  describe('hasRepositoryField', function () {
    it('accepts the string and object forms', function () {
      assert.equal(hasRepositoryField('github:ether/ep_align'), true);
      assert.equal(hasRepositoryField({type: 'git', url: 'git+https://x/y.git'}), true);
    });
    it('rejects missing or empty repositories', function () {
      for (const v of [undefined, null, '', ' ', {}, {url: ''}]) {
        assert.equal(hasRepositoryField(v), false, JSON.stringify(v));
      }
    });
  });

  describe('normalizeThirdPartyMode', function () {
    it('accepts the documented values in any case', function () {
      assert.equal(normalizeThirdPartyMode('hide'), 'hide');
      assert.equal(normalizeThirdPartyMode(' ALL '), 'all');
      assert.equal(normalizeThirdPartyMode('label'), 'label');
    });
    it('falls back to label for anything else', function () {
      assert.equal(normalizeThirdPartyMode(undefined), 'label');
      assert.equal(normalizeThirdPartyMode('nope'), 'label');
      assert.equal(normalizeThirdPartyMode(true), 'label');
    });
  });

  describe('isListedInCatalog', function () {
    const official = {name: 'ep_align', official: true, placeholder: false};
    const thirdParty = {name: 'ep_mypads', official: false, placeholder: false};
    const placeholder = {name: 'ep_nxs65012', official: false, placeholder: true};

    it('label: lists official and third-party, hides placeholders from browsing', function () {
      assert.equal(isListedInCatalog(official, 'label'), true);
      assert.equal(isListedInCatalog(thirdParty, 'label'), true);
      assert.equal(isListedInCatalog(placeholder, 'label'), false);
      assert.equal(isListedInCatalog(placeholder, 'label', 'nxs'), false);
    });

    it('label: an exact-name search still finds a placeholder', function () {
      assert.equal(isListedInCatalog(placeholder, 'label', 'EP_NXS65012 '), true);
    });

    it('hide: lists official plugins only', function () {
      assert.equal(isListedInCatalog(official, 'hide'), true);
      assert.equal(isListedInCatalog(thirdParty, 'hide'), false);
      assert.equal(isListedInCatalog(placeholder, 'hide', 'ep_nxs65012'), false);
    });

    it('all: lists everything', function () {
      assert.equal(isListedInCatalog(placeholder, 'all'), true);
      assert.equal(isListedInCatalog(thirdParty, 'all'), true);
    });
  });
});
