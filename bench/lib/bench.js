// V8 (d8) micro-benchmark harness for json-ty.
//
// Records a (library, payload) tuple per run so a single results file can
// drive a grouped bar chart (native vs
// json-ty vs fast-json-stringify). Run under d8/v8 with --allow-natives-syntax
// so blackbox() can defeat dead-code elimination.

const printFn =
  typeof globalThis.print === "function"
    ? globalThis.print.bind(globalThis)
    : console.log.bind(globalThis);

function writeFileCompat(path, data) {
  if (typeof globalThis.writeFile === "function") return globalThis.writeFile(path, data);
  throw new Error("writeFile is not available in this runtime");
}

const results = [];

/**
 * Time a routine and record the result.
 *
 * @param {string} library  e.g. "native", "json-ty", "fast-json-stringify"
 * @param {string} payload  e.g. "abc", "vec3", "player"
 * @param {() => void} routine
 * @param {number} ops
 * @param {number} bytesPerOp  bytes processed per op, for MB/s + GB/s
 */
export function bench(library, payload, routine, ops = 1_000_000, bytesPerOp = 0) {
  let warmup = Math.floor(ops / 10);
  while (warmup-- > 0) routine();

  const start = performance.now();
  let count = ops;
  while (count-- > 0) routine();
  const end = performance.now();

  const elapsed = Math.max(1e-3, end - start);
  const opsPerSecond = (ops * 1000) / elapsed;
  const nsPerOp = (elapsed * 1_000_000) / ops;

  let mbPerSec = 0;
  if (bytesPerOp > 0) mbPerSec = (bytesPerOp * ops) / (elapsed / 1000) / 1e6;

  results.push({
    library,
    payload,
    elapsed,
    bytes: bytesPerOp,
    operations: ops,
    nsPerOp,
    opsPerSec: opsPerSecond,
    mbps: mbPerSec,
  });

  let log = `   [${payload}] ${library.padEnd(20)} ${formatNumber(Math.round(opsPerSecond))} ops/s (${formatDurationPerOp(nsPerOp)})`;
  if (bytesPerOp > 0) log += ` @ ${formatNumber(Math.round(mbPerSec))} MB/s`;
  printFn(log);
}

export function dump(path) {
  writeFileCompat(path, JSON.stringify(results));
  printFn("\n  wrote " + results.length + " results -> " + path);
}

export function utf8ByteLength(value) {
  let len = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x80) len += 1;
    else if (c < 0x800) len += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
      const lo = value.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        len += 4;
        i++;
        continue;
      }
      len += 3;
    } else len += 3;
  }
  return len;
}

function formatNumber(n) {
  const str = n.toString();
  const len = str.length;
  let result = "";
  const commaOffset = len % 3;
  for (let i = 0; i < len; i++) {
    if (i > 0 && (i - commaOffset) % 3 === 0) result += ",";
    result += str.charAt(i);
  }
  return result;
}

function formatDurationPerOp(nsPerOp) {
  if (nsPerOp >= 1000) return `${(nsPerOp / 1000).toFixed(2)} us/op`;
  return `${nsPerOp.toFixed(2)} ns/op`;
}

export function blackbox(x) {
  try {
    (0, eval)("%PerformMicrotaskCheckpoint();");
  } catch {
    // Not running in d8 with --allow-natives-syntax.
  }
  return x;
}
