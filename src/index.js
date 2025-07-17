"use strict";
/// <reference path="./index.d.ts" />
Object.defineProperty(exports, "__esModule", { value: true });
exports.JSON = void 0;
/**
 * JSON Encoder/Decoder for TypeScript
 */
var JSON;
(function (JSON) {
  /**
   * Serializes valid JSON data
   * ```js
   * JSON.stringify<T>(data)
   * ```
   * @param data T
   * @returns string
   */
  function stringify(data, out = null) {
    throw new Error(`Could not serialize data. Make sure to add the correct decorators to classes.`);
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
})(JSON || (exports.JSON = JSON = {}));
