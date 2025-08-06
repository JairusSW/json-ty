/// <reference path="./index.d.ts" />
import { serializeArray, serializeBool, serializeFloat, serializeInteger, serializeString } from "./exports.js";
/**
 * JSON Encoder/Decoder for TypeScript
 */
export var JSON;
(function (JSON) {
    function from(cls, obj) {
        // @ts-ignore
        const o = cls.__JSON_INSTANTIATE();
        Object.assign(o, obj);
        return o;
    }
    JSON.from = from;
    /**
     * Serializes valid JSON data
     * ```js
     * JSON.stringify<T>(data)
     * ```
     * @param data T
     * @returns string
     */
    function stringify(data) {
        switch (typeof data) {
            case "string":
                return serializeString(data);
            case "boolean":
                return serializeBool(data);
            case "number":
                return serializeFloat(data);
            case "bigint":
                return serializeInteger(data);
            case "object":
                if (data === null)
                    return "null";
                if (Array.isArray(data))
                    return serializeArray(data);
                const ctor = data?.constructor;
                // console.log("ctor: ", ctor?.__JSON_SERIALIZE, data)
                if (ctor && ctor.__JSON_SERIALIZE) {
                    // @ts-ignore
                    return ctor.__JSON_SERIALIZE(data);
                }
                break;
        }
        throw new Error(`Could not serialize data of type '${typeof data}'. Make sure to add the correct decorators to classes.`);
    }
    JSON.stringify = stringify;
    /**
     * Parses valid JSON strings into their original format
     * ```js
     * JSON.parse<T>(data)
     * ```
     * @param data string
     * @returns T
     */
    function parse(data, cls = undefined) {
        /*if (!cls) */ return globalThis.JSON.parse(data);
        // return cls.__JSON_DESERIALIZE()
        // throw new Error(`Could not deserialize data ${data}. Make sure to add the correct decorators to classes.`);
    }
    JSON.parse = parse;
})(JSON || (JSON = {}));
