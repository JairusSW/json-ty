import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { RawNodeBinding, createSchemaRegistry } from "./node-binding.js";

const tier = process.env.JSON_TY_KERNEL_TIER ?? "naive";
const directory = `build/rfc-oracle/${tier}`;
const packed = readFileSync(
  "src/raw/fixtures/json-testsuite-parsing.json.gz.base64",
  "utf8",
).trim();
const corpus = JSON.parse(gunzipSync(Buffer.from(packed, "base64")));
const implementationSnapshot = JSON.parse(readFileSync(
  "src/raw/fixtures/json-testsuite-implementation-defined.json",
  "utf8",
));
assert.equal(corpus.commit, "1ef36fa01286573e846ac449e8683f8833c5b26a");
assert.equal(corpus.cases.length, 318);

const layouts = JSON.parse(readFileSync(`${directory}/schema-layouts.json`, "utf8"));
const schemas = createSchemaRegistry(layouts);
const binding = new RawNodeBinding(readFileSync(`${directory}/runtime.wasm`), {
  scratchCapacity: 2 << 20,
  heapReserve: 4 << 20,
});
const decoder = new TextDecoder("utf-8", { fatal: true });

const counts = {
  valid: 0,
  invalid: 0,
  implementationDefined: 0,
  malformedUtf8: 0,
  escape: 0,
  surrogate: 0,
  number: 0,
  nesting: 0,
  trailingData: 0,
  typed: 0,
};
const implementationBehavior = [];

function category(name) {
  return name[0];
}

function recordGroups(name, bytes) {
  let validUtf8 = true;
  try { decoder.decode(bytes); } catch { validUtf8 = false; }
  if (!validUtf8 || /utf.?8|utf16|utf-16|iso_latin|bom/i.test(name)) counts.malformedUtf8++;
  if (/escape|escaped|backslash/i.test(name)) counts.escape++;
  if (/surrogate/i.test(name)) counts.surrogate++;
  if (/number/i.test(name)) counts.number++;
  if (/nested|nesting|opening_arrays|open_array_object/i.test(name)) counts.nesting++;
  if (/trailing|garbage|after_/i.test(name)) counts.trailingData++;
}

function outcome(parse) {
  try {
    const value = parse();
    value?.dispose?.();
    return "accept";
  } catch {
    return "reject";
  }
}

function firstToken(bytes) {
  for (const value of bytes) {
    if (value !== 0x20 && value !== 0x09 && value !== 0x0a && value !== 0x0d) return value;
  }
  return -1;
}

function wrapped(bytes) {
  return Buffer.concat([Buffer.from('{"value":'), bytes, Buffer.from("}")]);
}

function wrappedUnknown(bytes) {
  return Buffer.concat([Buffer.from('{"fixture":'), bytes, Buffer.from("}")]);
}

function typedParser(name, bytes, acceptedValue, kind) {
  // Rejection and implementation-defined cases go through a generated typed
  // object's unknown-value grammar. The original bytes are embedded verbatim.
  if (kind !== "y") {
    return () => binding.parse(schemas.get("OracleObject"), wrappedUnknown(bytes));
  }
  const token = firstToken(bytes);
  if (token === 0x7b) return () => binding.parse(schemas.get("OracleObject"), bytes);
  if (token === 0x5b) {
    let schema;
    if (Array.isArray(acceptedValue)) {
      if (acceptedValue.every((value) => typeof value === "number")) schema = "OracleNumberArray";
      else if (acceptedValue.every((value) => typeof value === "string")) schema = "OracleStringArray";
      else if (acceptedValue.every((value) => typeof value === "boolean")) schema = "OracleBooleanArray";
      else if (acceptedValue.every((value) => value !== null && typeof value === "object" && !Array.isArray(value))) schema = "OracleObjectArray";
    }
    if (schema === undefined) {
      return () => binding.parse(schemas.get("OracleObject"), wrappedUnknown(bytes));
    }
    return () => binding.parse(schemas.get(schema), bytes);
  }
  if (token === 0x22 || token === 0x6e) {
    return () => binding.parse(schemas.get("OracleString"), wrapped(bytes));
  }
  if (token === 0x74 || token === 0x66) {
    return () => binding.parse(schemas.get("OracleBoolean"), wrapped(bytes));
  }
  return () => binding.parse(schemas.get("OracleNumber"), wrapped(bytes));
}

for (const [name, encoded] of corpus.cases) {
  const bytes = Buffer.from(encoded, "base64");
  const kind = category(name);
  recordGroups(name, bytes);

  let nativeValue;
  if (kind === "y") {
    counts.valid++;
    nativeValue = JSON.parse(decoder.decode(bytes));
  } else if (kind === "n") {
    counts.invalid++;
  } else {
    counts.implementationDefined++;
  }

  const dynamic = outcome(() => binding.parseDynamic(bytes));
  if (kind === "y") assert.equal(dynamic, "accept", `dynamic must accept ${name}`);
  if (kind === "n") assert.equal(dynamic, "reject", `dynamic must reject ${name}`);

  const typed = outcome(typedParser(name, bytes, nativeValue, kind));
  counts.typed++;
  if (kind === "y") assert.equal(typed, "accept", `typed must accept ${name}`);
  if (kind === "n") assert.equal(typed, "reject", `typed must reject ${name}`);
  if (kind === "i") implementationBehavior.push({ name, dynamic, typed });
}

assert.deepEqual(
  { valid: counts.valid, invalid: counts.invalid, implementationDefined: counts.implementationDefined },
  { valid: 95, invalid: 188, implementationDefined: 35 },
);
for (const group of ["malformedUtf8", "escape", "surrogate", "number", "nesting", "trailingData"]) {
  assert.ok(counts[group] > 0, `RFC oracle group ${group} must be represented`);
}
const observedAccept = implementationBehavior.filter((item) =>
  item.dynamic === "accept" && item.typed === "accept").map((item) => item.name);
const observedReject = implementationBehavior.filter((item) =>
  item.dynamic === "reject" && item.typed === "reject").map((item) => item.name);
assert.deepEqual(observedAccept, implementationSnapshot.accept, `${tier} implementation-defined accepts`);
assert.deepEqual(observedReject, implementationSnapshot.reject, `${tier} implementation-defined rejects`);

console.log(JSON.stringify({
  source: corpus.source,
  commit: corpus.commit,
  tier,
  counts,
  implementationBehavior,
}, null, 2));
console.log(`RFC oracle (${tier}): all public-interface cases passed`);
