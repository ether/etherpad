import {LRUCache} from 'lru-cache';
import type {Adapter, AdapterPayload} from "oidc-provider";

const options = {
  max: 500,
  sizeCalculation: (item: any, key: any) => 1,
  maxSize: 5000,
  ttl: 1000 * 60 * 5,
  allowStale: false,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
}

const epochTime = (date = Date.now()) => Math.floor(date / 1000);
const storage = new LRUCache<string, AdapterPayload | string[] | string>(options);

function grantKeyFor(id: string) {
  return `grant:${id}`;
}
function userCodeKeyFor(userCode: string) {
  return `userCode:${userCode}`;
}

class MemoryAdapter implements Adapter {
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  key(id: string) {
    return `${this.name}:${id}`;
  }

  destroy(id: string) {
    const key = this.key(id);
    const found = storage.get(key) as AdapterPayload | undefined;
    const grantId = found?.grantId;

    if (found?.userCode) {
      storage.delete(userCodeKeyFor(found.userCode));
    }

    storage.delete(key);

    if (grantId) {
      const grantKey = grantKeyFor(grantId);
      const tokens = storage.get(grantKey) as string[] | undefined;
      tokens?.forEach(token => storage.delete(token));
      storage.delete(grantKey);
    }

    return Promise.resolve();
  }

  consume(id: string) {
    const key = this.key(id);
    const payload = storage.get(key) as AdapterPayload | undefined;
    if (payload) {
      payload.consumed = epochTime();
      storage.set(key, payload);
    }
    return Promise.resolve();
  }

  find(id: string): Promise<AdapterPayload | void | undefined> {
    if (storage.has(this.key(id))) {
      return Promise.resolve(storage.get(this.key(id)) as AdapterPayload);
    }
    return Promise.resolve(undefined);
  }

  findByUserCode(userCode: string) {
    const id = storage.get(userCodeKeyFor(userCode)) as string;
    return this.find(id);
  }

  upsert(id: string, payload: AdapterPayload, expiresIn: number) {
    const key = this.key(id);

    if (payload.grantId) {
      const grantKey = grantKeyFor(payload.grantId);
      const grant = (storage.get(grantKey) as string[]) || [];
      if (!grant.includes(key)) grant.push(key);
      storage.set(grantKey, grant);
    }

    if (payload.userCode) {
      storage.set(userCodeKeyFor(payload.userCode), id);
    }

    storage.set(key, payload, {ttl: expiresIn * 1000});
    return Promise.resolve();
  }

  findByUid(uid: string): Promise<AdapterPayload | void | undefined> {
    for (const [_, value] of storage.entries()) {
      if (typeof value === "object" && "uid" in value && value.uid === uid) {
        return Promise.resolve(value as AdapterPayload);
      }
    }
    return Promise.resolve(undefined);
  }

  revokeByGrantId(grantId: string): Promise<void | undefined> {
    const grantKey = grantKeyFor(grantId);
    const grant = storage.get(grantKey) as string[] | undefined;
    if (grant) {
      grant.forEach((token) => storage.delete(token));
      storage.delete(grantKey);
    }
    return Promise.resolve();
  }
}

export default MemoryAdapter;
