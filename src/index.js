/// <reference path="./index.d.ts" />
import { serializeArray, serializeBool, serializeFloat, serializeInteger, serializeString } from "./exports.js";
/**
 * JSON Encoder/Decoder for TypeScript
 */
export var JSON;
(function (JSON) {
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
                break;
        }
        const ctor = data?.constructor;
        if (ctor && typeof ctor.__JSON_SERIALIZE === "function") {
            // @ts-ignore
            return ctor.__JSON_SERIALIZE(data);
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
    function parse(data) {
        throw new Error(`Could not deserialize data ${data}. Make sure to add the correct decorators to classes.`);
    }
    JSON.parse = parse;
    /**
   * Serializes a number to a JSON string
   * @param value number
   * @returns string
   */
    JSON._serializeFloat = serializeFloat;
})(JSON || (JSON = {}));
