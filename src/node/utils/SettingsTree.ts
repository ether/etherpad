import {MapArrayType} from "../types/MapType";

export class SettingsTree {
    private children: Map<string, SettingsNode>;
    constructor() {
        this.children = new Map();
    }

    public addChild(key: string, value: string) {
        this.children.set(key, new SettingsNode(key, value));
    }

    public removeChild(key: string) {
        this.children.delete(key);
    }

    public getChild(key: string) {
        return this.children.get(key);
    }

    public hasChild(key: string) {
        return this.children.has(key);
    }
}


export class SettingsNode {
    private readonly key: string;
    private value:  string | number | boolean | null | undefined;
    private children: MapArrayType<SettingsNode>;

    constructor(key: string, value?:  string | number | boolean | null | undefined) {
        this.key = key;
        this.value = value;
        this.children = {}
    }

    public addChild(path: string[], value: string) {
        let currentNode:SettingsNode = this;
        for (let i = 0; i < path.length; i++) {
            const key = path[i];
            /*
                Skip the current node if the key is the same as the current node's key
             */
            if (key === this.key ) {
                continue
            }
            /*
                If the current node does not have a child with the key, create a new node with the key
             */
            if (!currentNode.hasChild(key)) {
                currentNode = currentNode.children[key] = new SettingsNode(key, this.coerceValue(value));
            } else {
                /*
                 Else move to the child node
                 */
                currentNode = currentNode.getChild(key);
            }
        }
    }


    public collectFromLeafsUpwards() {
        let collected:MapArrayType<any> = {};
        for (const key in this.children) {
            const child = this.children[key];
            if (child.hasChildren()) {
                collected[key] = child.collectFromLeafsUpwards();
            } else {
                collected[key] = child.value;
            }
        }
        return collected;
    }

    coerceValue = (stringValue: string) => {
        // cooked from https://stackoverflow.com/questions/175739/built-in-way-in-javascript-to-check-if-a-string-is-a-valid-number
        // @ts-ignore
        const isNumeric = !isNaN(stringValue) && !isNaN(parseFloat(stringValue) && isFinite(stringValue));

        if (isNumeric) {
            // detected numeric string. Coerce to a number

            return +stringValue;
        }

        switch (stringValue) {
            case 'true':
                return true;
            case 'false':
                return false;
            case 'undefined':
                return undefined;
            case 'null':
                return null;
            default:
                return stringValue;
        }
    };

    public hasChildren() {
        return Object.keys(this.children).length > 0;
    }

    public getChild(key: string) {
        return this.children[key];
    }

    public hasChild(key: string) {
        return this.children[key] !== undefined;
    }
}
