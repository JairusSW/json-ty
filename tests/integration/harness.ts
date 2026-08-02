type Callback = () => void;

let assertions = 0;
let suites = 0;
const pending: Array<{ name: string; callback: Callback }> = [];

Object.assign(globalThis, {
  i8: { MIN_VALUE: -128, MAX_VALUE: 127 },
  i16: { MIN_VALUE: -32768, MAX_VALUE: 32767 },
  i32: { MIN_VALUE: -2147483648, MAX_VALUE: 2147483647 },
  i64: { MIN_VALUE: Number.MIN_SAFE_INTEGER, MAX_VALUE: Number.MAX_SAFE_INTEGER },
  u8: { MIN_VALUE: 0, MAX_VALUE: 255 },
  u16: { MIN_VALUE: 0, MAX_VALUE: 65535 },
  u32: { MIN_VALUE: 0, MAX_VALUE: 4294967295 },
  u64: { MIN_VALUE: 0, MAX_VALUE: Number.MAX_SAFE_INTEGER },
  f32: Number,
  f64: Number,
});

function render(value: unknown): string {
  try { return globalThis.JSON.stringify(value); }
  catch { return String(value); }
}

export function describe(name: string, callback: Callback): void {
  pending.push({ name, callback });
}

export function runSuites(): void {
  for (const { name, callback } of pending) {
    suites++;
    try { callback(); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${name}: ${message}`, { cause: error });
    }
  }
  pending.length = 0;
}

export function expect<T = unknown>(actual: T): {
  toBe(expected: unknown): void;
  toBeNull(): void;
  toStrictEqual(expected: unknown): void;
  toThrow(): void;
} {
  return {
    toBe(expected: unknown): void {
      assertions++;
      if (!Object.is(actual, expected)) throw new Error(`expected ${render(expected)}, received ${render(actual)}`);
    },
    toBeNull(): void {
      assertions++;
      if (actual !== null && actual !== undefined) throw new Error(`expected null, received ${render(actual)}`);
    },
    toStrictEqual(expected: unknown): void {
      assertions++;
      if (render(actual) !== render(expected)) throw new Error(`expected ${render(expected)}, received ${render(actual)}`);
    },
    toThrow(): void {
      assertions++;
      if (typeof actual !== "function") throw new Error("toThrow requires a function");
      let threw = false;
      try { (actual as Callback)(); }
      catch { threw = true; }
      if (!threw) throw new Error("expected function to throw");
    },
  };
}

export function testCounts(): { assertions: number; suites: number } {
  return { assertions, suites };
}
