// The OIDC provider hands the login and consent pages the interaction uid in
// the `state` query parameter. oidc-provider generates it with nanoid, so it
// only ever contains URL-safe base64 characters. Anything else is rejected so
// the page only ever posts to /interaction/<uid>.
const INTERACTION_UID = /^[A-Za-z0-9_-]{1,128}$/;

export const isValidInteractionUid = (uid: unknown): uid is string =>
  typeof uid === 'string' && INTERACTION_UID.test(uid);

// Returns the POST target for the interaction, or null when `state` is not a
// valid interaction uid.
export const interactionPath = (uid: unknown): string | null =>
  isValidInteractionUid(uid) ? `/interaction/${encodeURIComponent(uid)}` : null;
