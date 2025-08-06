/// <reference path="./index.d.ts" />
import { serializeArray, serializeBool, serializeFloat, serializeInteger, serializeString } from "./exports.js";

/**
 * JSON Encoder/Decoder for TypeScript
 */
export namespace JSON {
  export function from<T extends object>(cls: { new(): T }, obj: Partial<T>): T {
    // @ts-ignore
    const o = cls.__JSON_INSTANTIATE();
    Object.assign(o, obj);
    return o;
  }
  /**
   * Serializes valid JSON data
   * ```js
   * JSON.stringify<T>(data)
   * ```
   * @param data T
   * @returns string
   */
  export function stringify<T>(data: T): string {
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
        if (data === null) return "null";
        if (Array.isArray(data)) return serializeArray(data);
        const ctor = (data as any)?.constructor;
        // console.log("ctor: ", ctor?.__JSON_SERIALIZE, data)

        if (ctor && ctor.__JSON_SERIALIZE) {
          // @ts-ignore
          return ctor.__JSON_SERIALIZE(data);
        }
        break;
    }
    throw new Error(`Could not serialize data of type '${typeof data}'. Make sure to add the correct decorators to classes.`);
  }

  /**
   * Parses valid JSON strings into their original format
   * ```js
   * JSON.parse<T>(data)
   * ```
   * @param data string
   * @returns T
   */
  export function parse<T>(data: string, cls: { new(): T } | undefined = undefined): T {
    /*if (!cls) */return globalThis.JSON.parse(data) as T;
    // return cls.__JSON_DESERIALIZE()
    // throw new Error(`Could not deserialize data ${data}. Make sure to add the correct decorators to classes.`);
  }
}
