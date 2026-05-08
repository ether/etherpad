// admin/scripts/merge-openapi.mjs
//
// Deep-merges the public-API OpenAPI document with the admin OpenAPI
// document into a single document for openapi-typescript to consume.
//
// Rules:
//   - paths: union by key; collision throws
//   - components.{schemas,parameters,responses,securitySchemes}: union by name; collision throws
//   - root info, servers, security: public wins (admin's are ignored at the root)
//   - per-operation security on admin paths is preserved untouched

const unionMap = (label, a = {}, b = {}) => {
  const out = {...a};
  for (const [k, v] of Object.entries(b)) {
    if (k in out) {
      throw new Error(`${label} on key "${k}"`);
    }
    out[k] = v;
  }
  return out;
};

export const mergeOpenAPI = (publicDoc, adminDoc) => {
  if (!publicDoc || !adminDoc) {
    throw new Error('mergeOpenAPI requires both publicDoc and adminDoc');
  }
  return {
    openapi: publicDoc.openapi || adminDoc.openapi,
    info: publicDoc.info,
    ...(publicDoc.servers ? {servers: publicDoc.servers} : {}),
    ...(publicDoc.security ? {security: publicDoc.security} : {}),
    paths: unionMap('path collision', publicDoc.paths, adminDoc.paths),
    components: {
      schemas: unionMap(
        'schema collision',
        publicDoc.components?.schemas,
        adminDoc.components?.schemas,
      ),
      parameters: unionMap(
        'parameter collision',
        publicDoc.components?.parameters,
        adminDoc.components?.parameters,
      ),
      responses: unionMap(
        'response collision',
        publicDoc.components?.responses,
        adminDoc.components?.responses,
      ),
      securitySchemes: unionMap(
        'securityScheme collision',
        publicDoc.components?.securitySchemes,
        adminDoc.components?.securitySchemes,
      ),
    },
  };
};
