import path from 'path';

// Normalizes p and ensures that it is a relative path that does not reach outside. See
// https://nvd.nist.gov/vuln/detail/CVE-2015-3297 for additional context.
const sanitizeRoot =  (p: string, pathApi = path) => {
  // The documentation for path.normalize() says that it resolves '..' and '.' segments. The word
  // "resolve" implies that it examines the filesystem to resolve symbolic links, so 'a/../b' might
  // not be the same thing as 'b'. Most path normalization functions from other libraries (e.g.,
  // Python's os.path.normpath()) clearly state that they do not examine the filesystem. Here we
  // assume Node.js's path.normalize() does the same; that it is only a simple string manipulation.
  p = pathApi.normalize(p);
  if (pathApi.isAbsolute(p)) throw new Error(`absolute paths are forbidden: ${p}`);
  if (p.split(pathApi.sep)[0] === '..') throw new Error(`directory traversal: ${p}`);
  // On Windows, path normalization replaces forwardslashes with backslashes. Convert them back to
  // forwardslashes. Node.js treats both the backlash and the forwardslash characters as pathname
  // component separators on Windows so this does not change the meaning of the pathname on Windows.
  // THIS CONVERSION MUST ONLY BE DONE ON WINDOWS, otherwise on POSIXish systems '..\\' in the input
  // pathname would not be normalized away before being converted to '../'.
  if (pathApi.sep === '\\') p = p.replace(/\\/g, '/');
  return p;
};

export default sanitizeRoot
