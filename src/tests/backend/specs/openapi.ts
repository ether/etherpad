'use strict';

const assert = require('assert').strict;

describe('openapi server URL generation', function () {
  let generateServerForApiVersion: (apiRoot: string, req: any) => {url: string};

  before(function () {
    ({generateServerForApiVersion} = require('../../../node/hooks/express/openapi'));
  });

  const mockReq = (protocol: string, host: string) => ({protocol, headers: {host}});

  it('emits http:// for a plain HTTP request', function () {
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('http', 'pad.example.com')),
        {url: 'http://pad.example.com/api/1.2.15'});
  });

  it('emits https:// when the request protocol is https (TLS or reverse proxy)', function () {
    assert.deepEqual(
        generateServerForApiVersion('/api/1.2.15', mockReq('https', 'pad.example.com')),
        {url: 'https://pad.example.com/api/1.2.15'});
  });
});
