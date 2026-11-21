import path from 'path';

type PathApi = typeof path.posix | typeof path.win32;

/**
 * Returns true if `target` is `base` or lies underneath it. Both arguments should be absolute.
 * Uses path.relative(), so on Windows the comparison is case-insensitive and a target on a
 * different drive (for which relative() returns an absolute path) is reported as outside.
 */
export const isPathInside = (base: string, target: string, pathApi: PathApi = path) => {
  const rel = pathApi.relative(base, target);
  if (rel === '') return true;
  if (pathApi.isAbsolute(rel)) return false;
  return !rel.split(pathApi.sep).includes('..');
};

// Normalizes p and ensures that it is a relative path that does not reach outside. See
// https://nvd.nist.gov/vuln/detail/CVE-2015-3297 for additional context.
const sanitizeRoot =  (p: string, pathApi: PathApi = path) => {
  if (p.includes('\0')) throw new Error(`NUL bytes are forbidden: ${JSON.stringify(p)}`);
  // The documentation for path.normalize() says that it resolves '..' and '.' segments. The word
  // "resolve" implies that it examines the filesystem to resolve symbolic links, so 'a/../b' might
  // not be the same thing as 'b'. Most path normalization functions from other libraries (e.g.,
  // Python's os.path.normpath()) clearly state that they do not examine the filesystem. Here we
  // assume Node.js's path.normalize() does the same; that it is only a simple string manipulation.
  const raw = p;
  p = pathApi.normalize(p);
  // On Windows this also catches UNC (\\server\share) and device (\\?\, \\.\) paths.
  if (pathApi.isAbsolute(p)) throw new Error(`absolute paths are forbidden: ${p}`);
  if (pathApi.sep === '\\') {
    // A drive-relative path such as 'C:..\\foo' is not "absolute", but path.win32.resolve()
    // resolves it against that drive rather than against the base directory. A colon is also the
    // NTFS alternate data stream separator ('file::$DATA'). Static asset names never contain one,
    // so reject any colon.
    // Checked on the raw input so a colon cannot be normalized away first.
    if (raw.includes(':')) throw new Error(`drive designators and colons are forbidden: ${p}`);
  }
  if (p.split(pathApi.sep).includes('..')) throw new Error(`directory traversal: ${p}`);
  // The result must also stay inside an arbitrary base directory once resolved.
  const sentinel = pathApi.sep === '\\' ? 'Z:\\sanitize-root' : '/sanitize-root';
  if (!isPathInside(sentinel, pathApi.resolve(sentinel, p), pathApi)) {
    throw new Error(`directory traversal: ${p}`);
  }
  // On Windows, path normalization replaces forwardslashes with backslashes. Convert them back to
  // forwardslashes. Node.js treats both the backlash and the forwardslash characters as pathname
  // component separators on Windows so this does not change the meaning of the pathname on Windows.
  // THIS CONVERSION MUST ONLY BE DONE ON WINDOWS, otherwise on POSIXish systems '..\\' in the input
  // pathname would not be normalized away before being converted to '../'.
  if (pathApi.sep === '\\') p = p.replace(/\\/g, '/');
  return p;
};

export default sanitizeRoot
