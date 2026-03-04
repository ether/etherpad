import {LRUCache} from 'lru-cache';
import type {Adapter, AdapterPayload} from "oidc-provider";


const options = {
    max: 500,
    sizeCalculation: (item:any, key:any) => {
        return 1
    },
    // for use with tracking overall storage size
    maxSize: 5000,

    // how long to live in ms
    ttl: 1000 * 60 * 5,

    // return stale items before removing from cache?
    allowStale: false,

    updateAgeOnGet: false,
    updateAgeOnHas: false,
}

const epochTime = (date = Date.now()) => Math.floor(date / 1000);

const storage = new LRUCache<string,AdapterPayload|string[]|string>(options);

function grantKeyFor(id: string) {
    return `grant:${id}`;
}

function userCodeKeyFor(userCode:string) {
    return `userCode:${userCode}`;
}

class MemoryAdapter implements Adapter{
    private readonly name: string;
    constructor(name:string) {
        this.name = name;
    }

    key(id:string) {
        return `${this.name}:${id}`;
    }

    destroy(id:string) {
        const key = this.key(id);

        const found = storage.get(key) as AdapterPayload;
        const grantId = found && found.grantId;

        storage.delete(key);

        if (grantId) {
            const grantKey = grantKeyFor(grantId);
            (storage.get(grantKey) as string[])!.forEach(token => storage.delete(token));
            storage.delete(grantKey);
        }

        return Promise.resolve();
    }

    consume(id: string) {
        (storage.get(this.key(id)) as AdapterPayload)!.consumed = epochTime();
        return Promise.resolve();
    }

    find(id: string): Promise<AdapterPayload | void | undefined> {
        if (storage.has(this.key(id))){
            return Promise.resolve<AdapterPayload>(storage.get(this.key(id)) as AdapterPayload);
        }
        return Promise.resolve<undefined>(undefined)
    }

    findByUserCode(userCode: string) {
        const id = storage.get(userCodeKeyFor(userCode)) as string;
        return this.find(id);
    }

    upsert(id: string, payload: {
        iat: number;
        exp: number;
        uid: string;
        kind: string;
        jti: string;
        accountId: string;
        loginTs: number;
    }, expiresIn: number) {
        const key = this.key(id);

        storage.set(key, payload, {ttl: expiresIn * 1000});

        return Promise.resolve();
    }

    findByUid(uid: string): Promise<AdapterPayload | void | undefined> {
        for(const [_, value] of storage.entries()){
            if(typeof value ==="object" && "uid" in value && value.uid === uid){
                return Promise.resolve(value);
            }
        }
        return Promise.resolve(undefined);
    }

    revokeByGrantId(grantId: string): Promise<void | undefined> {
        const grantKey = grantKeyFor(grantId);
        const grant = storage.get(grantKey) as string[];
        if (grant) {
            grant.forEach((token) => storage.delete(token));
            storage.delete(grantKey);
        }
        return Promise.resolve();
    }
}

export default MemoryAdapter
