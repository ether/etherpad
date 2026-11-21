import {strict as assert} from "assert";
import path from 'path';
import sanitizePathname, {isPathInside} from '../../../node/utils/sanitizePathname';
import {describe, it, expect} from 'vitest';

describe(__filename, function () {
  describe('absolute paths rejected', function () {
    const testCases = [
      ['posix', '/'],
      ['posix', '/foo'],
      ['win32', '/'],
      ['win32', '\\'],
      ['win32', 'C:/foo'],
      ['win32', 'C:\\foo'],
      ['win32', 'c:/foo'],
      ['win32', 'c:\\foo'],
      ['win32', '/foo'],
      ['win32', '\\foo'],
    ];
    for (const [platform, p] of testCases) {
      it(`${platform} ${p}`, async function () {
        // @ts-ignore
        expect(() => sanitizePathname(p, path[platform] as any)).toThrowError(/absolute path/);
      });
    }
  });
  describe('directory traversal rejected', function () {
    const testCases = [
      ['posix', '..'],
      ['posix', '../'],
      ['posix', '../foo'],
      ['posix', 'foo/../..'],
      ['win32', '..'],
      ['win32', '../'],
      ['win32', '..\\'],
      ['win32', '../foo'],
      ['win32', '..\\foo'],
      ['win32', 'foo/../..'],
      ['win32', 'foo\\..\\..'],
    ];
    for (const [platform, p] of testCases) {
      it(`${platform} ${p}`, async function () {
        // @ts-ignore
        assert.throws(() => sanitizePathname(p, path[platform]), {message: /travers/});
      });
    }
  });

  // Drive-relative paths are not absolute and do not start with a '..' component, but
  // path.win32.resolve() resolves them against the drive instead of the base directory.
  describe('win32 drive designators, colons, UNC and device paths rejected', function () {
    const testCases: [string, RegExp][] = [
      ['C:..\\..\\..\\Windows\\win.ini', /drive designator/],
      ['C:../../../Windows/win.ini', /drive designator/],
      ['c:..\\..\\Windows\\win.ini', /drive designator/],
      ['D:..\\foo.txt', /drive designator/],
      ['C:..', /drive designator/],
      ['C:', /drive designator/],
      ['C:.', /drive designator/],
      ['C:foo', /drive designator/],
      ['C:Windows\\win.ini', /drive designator/],
      ['js/pad.js::$DATA', /drive designator/],
      ['js/pad.js:stream', /drive designator/],
      ['foo/C:..\\..\\x', /drive designator/],
      ['C:/Windows/win.ini', /absolute path/],
      ['C:\\Windows\\win.ini', /absolute path/],
      ['\\\\server\\share\\x', /absolute path/],
      ['//server/share/x', /absolute path/],
      ['\\\\?\\C:\\Windows\\win.ini', /absolute path/],
      ['\\\\.\\C:\\Windows\\win.ini', /absolute path/],
      ['//?/C:/Windows/win.ini', /absolute path/],
      ['foo\0bar', /NUL/],
    ];
    for (const [p, want] of testCases) {
      it(`win32 ${p}`, async function () {
        expect(() => sanitizePathname(p, path.win32)).toThrowError(want);
      });
    }
    it('path.win32.resolve() resolves a drive-relative path outside the base', async function () {
      const root = 'C:\\etherpad\\src\\static\\';
      const resolved = path.win32.resolve(root, 'C:../../../Windows/win.ini');
      assert.equal(resolved, 'C:\\Windows\\win.ini');
      assert.equal(isPathInside(root, resolved, path.win32), false);
    });
  });

  describe('posix behaviour unchanged for colons', function () {
    for (const p of ['C:..', 'C:foo', 'a:b', 'js/pad.js::$DATA']) {
      it(`posix ${p}`, async function () {
        assert.equal(sanitizePathname(p, path.posix), p);
      });
    }
    it('posix NUL rejected', async function () {
      expect(() => sanitizePathname('foo\0', path.posix)).toThrowError(/NUL/);
    });
  });

  describe('isPathInside', function () {
    const testCases: [string, string, string, boolean][] = [
      ['posix', '/r/s', '/r/s', true],
      ['posix', '/r/s', '/r/s/a/b', true],
      ['posix', '/r/s/', '/r/s/a', true],
      ['posix', '/r/s', '/r/s/..foo', true],
      ['posix', '/r/s', '/r', false],
      ['posix', '/r/s', '/r/sx', false],
      ['posix', '/r/s', '/etc/passwd', false],
      ['win32', 'C:\\r\\s', 'C:\\r\\s\\a', true],
      ['win32', 'C:\\r\\s', 'c:\\R\\S\\a', true],
      ['win32', 'C:\\r\\s', 'C:\\r\\s\\..foo', true],
      ['win32', 'C:\\r\\s', 'C:\\r', false],
      ['win32', 'C:\\r\\s', 'C:\\r\\sx', false],
      ['win32', 'C:\\r\\s', 'C:\\Windows\\win.ini', false],
      ['win32', 'C:\\r\\s', 'D:\\r\\s\\a', false],
      ['win32', 'C:\\r\\s', '\\\\server\\share\\r\\s', false],
    ];
    for (const [platform, base, target, want] of testCases) {
      it(`${platform} ${target} in ${base} -> ${want}`, async function () {
        // @ts-ignore
        assert.equal(isPathInside(base, target, path[platform]), want);
      });
    }
  });

  describe('accepted paths', function () {
    const testCases = [
      ['posix', '', '.'],
      ['posix', '.'],
      ['posix', './'],
      ['posix', 'foo'],
      ['posix', 'foo/'],
      ['posix', 'foo/bar/..', 'foo'],
      ['posix', 'foo/bar/../', 'foo/'],
      ['posix', './foo', 'foo'],
      ['posix', 'foo/bar'],
      ['posix', 'foo\\bar'],
      ['posix', '\\foo'],
      ['posix', '..\\foo'],
      ['posix', 'foo/../bar', 'bar'],
      ['posix', 'C:/foo'],
      ['posix', 'C:\\foo'],
      ['win32', '', '.'],
      ['win32', '.'],
      ['win32', './'],
      ['win32', '.\\', './'],
      ['win32', 'foo'],
      ['win32', 'foo/'],
      ['win32', 'foo\\', 'foo/'],
      ['win32', 'foo/bar/..', 'foo'],
      ['win32', 'foo\\bar\\..', 'foo'],
      ['win32', 'foo/bar/../', 'foo/'],
      ['win32', 'foo\\bar\\..\\', 'foo/'],
      ['win32', './foo', 'foo'],
      ['win32', '.\\foo', 'foo'],
      ['win32', 'foo/bar'],
      ['win32', 'foo\\bar', 'foo/bar'],
      ['win32', 'foo/../bar', 'bar'],
      ['win32', 'foo\\..\\bar', 'bar'],
      ['win32', 'foo/..\\bar', 'bar'],
      ['win32', 'foo\\../bar', 'bar'],
    ];
    for (const [platform, p, tcWant] of testCases) {
      const want = tcWant == null ? p : tcWant;
      it(`${platform} ${p || '<empty string>'} -> ${want}`, async function () {
        // @ts-ignore
        assert.equal(sanitizePathname(p, path[platform]), want);
      });
    }
  });

  it('default path API', async function () {
    assert.equal(sanitizePathname('foo'), 'foo');
  });
});
