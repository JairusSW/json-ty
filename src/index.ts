/// <reference path="./index.d.ts" />

import { serializeBool } from "./serialize/bool";
import { serializeString } from "./serialize/string";

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
  export function stringify<T>(data: T, out: string | null = null): string {
    if (typeof data === "string") {
      return serializeString(data);
    } else if (typeof data === "boolean") {
      return serializeBool(data);
    } else if (typeof data === "number") {
      return serializeNumber(data);
    }
    throw new Error(`Could not serialize data. Make sure to add the correct decorators to classes.`);
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
}
