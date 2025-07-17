/// <reference path="./index.d.ts" />

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
