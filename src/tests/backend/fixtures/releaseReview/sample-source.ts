// Fixture: a sample source file used for fingerprint stability tests.
// Do NOT edit the body of this file casually — fingerprint tests assert
// specific content around line 5 and line 9.

export const greet = (name: string): string => {
  // line 5 (1-indexed): the equality check below is the seeded "finding"
  if (name == null) return 'hello stranger';
  return `hello ${name}`;
};

export const farewell = (name: string): string => {
  return `bye ${name}`;
};
