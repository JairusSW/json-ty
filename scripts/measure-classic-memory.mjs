import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RawNodeBinding } from "../src/raw/node-binding.js";
import { classicCorpora } from "../bench/classic/manifest.mjs";

const MIB = 1 << 20;
const PAGE = 1 << 16;
const maximumSlack = Number(
  process.env.JSON_TY_MAX_DOCUMENT_SLACK ?? Number.POSITIVE_INFINITY,
);
const modes = (process.env.JSON_TY_MEMORY_MODES ?? "eager,lazy")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (modes.some((mode) => mode !== "eager" && mode !== "lazy")) {
  throw new Error("JSON_TY_MEMORY_MODES must contain only eager and/or lazy");
}
const payloadDirectory =
  process.env.JSON_TY_CLASSIC_PAYLOADS ??
  resolve("../json-as/assembly/__benches__/payloads");
const wasm = readFileSync("build/classic/runtime.wasm");

function alignPage(value) {
  return Math.ceil(value / PAGE) * PAGE;
}

let failures = 0;
const results = [];
for (const corpus of classicCorpora) {
  const file = corpus.files.min;
  const input = readFileSync(resolve(payloadDirectory, file));
  for (const mode of modes) {
    const scratchCapacity = Math.max(MIB, alignPage(input.length + MIB));
    const runtime = new RawNodeBinding(wasm, {
      scratchCapacity,
      heapReserve: PAGE,
    });
    const initialBytes = runtime.memory.buffer.byteLength;
    const view = runtime.parseDynamic(input, {
      eager: mode === "eager",
      validate: true,
    });
    const document = view._document();
    if (mode === "lazy") {
      const root = document + runtime.u32[(document + 12) >>> 2];
      const materialized = runtime._callWithMemoryRefresh(
        runtime._materializeDynamicTree,
        document,
        root,
      );
      if (materialized === 0) {
        throw new Error(`${corpus.key}: lazy graph failed to materialize`);
      }
    }
    const peakBytes = runtime.memory.buffer.byteLength;
    const reservedBytes = runtime.u32[(document - 8) >>> 2] & 0x7fffffff;
    const usedBytes = runtime.u32[document >>> 2] & 0x7fffffff;
    const slack = reservedBytes / usedBytes;
    const passed = slack <= maximumSlack;
    if (!passed) failures++;
    results.push({
      payload: corpus.key,
      mode,
      inputBytes: input.length,
      initialBytes,
      peakBytes,
      reservedBytes,
      usedBytes,
      slack,
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} ${`${corpus.key}/${mode}`.padEnd(20)} ` +
        `peak=${(peakBytes / MIB).toFixed(1).padStart(7)} MiB ` +
        `document=${(reservedBytes / MIB).toFixed(1).padStart(7)} MiB ` +
        `used=${(usedBytes / MIB).toFixed(1).padStart(7)} MiB ` +
        `slack=${slack.toFixed(2)}x`,
    );
    view.dispose();
  }
}

if (failures !== 0) {
  throw new Error(
    `${failures}/${results.length} classic documents exceed ${maximumSlack.toFixed(2)}x allocation slack`,
  );
}
