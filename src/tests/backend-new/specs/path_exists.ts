import check from "../../../node/utils/path_exists";
import {expect, describe, it} from "vitest";

describe('Test path exists', function () {
  it('should return true if the path exists - directory', function () {
    const path = './locales';
    const result = check(path);
    expect(result).toBeTruthy();
  });

  it('should return true if the path exists - file', function () {
    const path = './locales/en.json';
    const result = check(path);
    expect(result).toBeTruthy();
  })

  it('should return false if the path does not exist', function () {
    const path = './path_not_exists.ts';
    const result = check(path);
    expect(result).toEqual(false);
  });
})
