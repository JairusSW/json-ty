// serializeString.d.ts

/**
 * Escapes a string for safe inclusion in JSON output.
 * Escapes control characters, quotes, and backslashes.
 *
 * @param data - The input string to serialize.
 * @returns A JSON-safe, double-quoted string.
 */
export function serializeString(data: string): string;
