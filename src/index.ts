/// <reference path="./index.d.ts" />
import {
  serializeArray,
  serializeBool,
  serializeFloat,
  serializeInteger,
  serializeString
} from "./exports.js";

/**
 * JSON Encoder/Decoder for TypeScript
 */
export namespace JSON {
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
        break;
    }
    const ctor = (data as any)?.constructor;

    if (ctor && typeof ctor.__JSON_SERIALIZE === "function") {
      // @ts-ignore
      return ctor.__JSON_SERIALIZE(data);
    }
    throw new Error(
      `Could not serialize data of type '${typeof data}'. Make sure to add the correct decorators to classes.`
    );
  }

  /**
   * Parses valid JSON strings into their original format
   * ```js
   * JSON.parse<T>(data)
   * ```
   * @param data string
   * @returns T
   */
  export function parse<T>(data: string): T {
    throw new Error(`Could not deserialize data ${data}. Make sure to add the correct decorators to classes.`);
  }

  /**
 * Serializes a number to a JSON string
 * @param value number
 * @returns string
 */
  export const _serializeFloat: (value: number) => string = serializeFloat;

}
