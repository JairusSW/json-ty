import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject } from "../lib/build.js";
import { RawNodeBinding, createSchemaRegistry } from "../../src/raw/node-binding.js";

const temporary = mkdtempSync(join(tmpdir(), "json-ty-build-"));
const generatedDirectory = join(temporary, "generated");
const cacheDirectory = join(temporary, "cache");
const options = {
  configPath: "compiler/fixtures/tsconfig.json",
  generatedDirectory,
  cacheDirectory,
  emitTypeScript: false,
};

const first = await buildProject(options);
const second = await buildProject(options);
assert.equal(first.cacheHit, false);
assert.equal(second.cacheHit, true);
assert.equal(first.hash, second.hash);
assert.deepEqual(readFileSync(first.wasmPath), readFileSync(second.wasmPath));

const emittedConfigPath = join(temporary, "tsconfig.emit.json");
const emittedDirectory = join(temporary, "dist");
const emittedGeneratedDirectory = join(temporary, "generated-emitted");
writeFileSync(emittedConfigPath, JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    experimentalDecorators: true,
    rootDir: resolve("."),
    outDir: emittedDirectory,
  },
  files: [
    resolve("compiler/fixtures/json-ty.d.ts"),
    resolve("compiler/fixtures/analyzer.ts"),
  ],
}));
await buildProject({
  configPath: emittedConfigPath,
  generatedDirectory: emittedGeneratedDirectory,
  cacheDirectory,
});
const emittedApplication = readFileSync(join(emittedDirectory, "compiler/fixtures/analyzer.js"), "utf8");
assert.match(
  emittedApplication,
  /from "\.\.\/\.\.\/\.\.\/generated-emitted\/runtime\.js"/,
  "generated runtime imports must be relative to each emitted application file",
);

const layouts = JSON.parse(readFileSync(first.layoutsPath, "utf8"));
const generatedHost = readFileSync(first.runtimePath, "utf8");
assert.match(generatedHost, /class PlayerHostView extends GeneratedViewBase/);
assert.match(generatedHost, /runtime\.f64\[\(root \+ \d+\) >>> 3\]/);
assert.match(generatedHost, /decodeStringRef\(runtime, document, root \+ \d+/);
assert.match(generatedHost, /binding\.exports\.p\d+/);
assert.match(generatedHost, /export const p\d+ = \(input, constructor\)/);
assert.match(generatedHost, /export const s\d+ = \(value\)/);
assert.match(generatedHost, /invalidateGeneratedView\(this\)/);
assert.match(generatedHost, /this\[RAW_OVERLAY\] = overlay = Object\.create\(null\)/);
assert.doesNotMatch(generatedHost, /parse\(name, input/);
assert.doesNotMatch(generatedHost, /createObjectView/);
const executableRuntimePath = join(generatedDirectory, "runtime-executable.mjs");
writeFileSync(executableRuntimePath, generatedHost.replace('from "json-ty/raw"', `from ${JSON.stringify(pathToFileURL(resolve("src/raw/index.js")).href)}`));
const generatedRuntime = await import(`${pathToFileURL(executableRuntimePath).href}?${Date.now()}`);
class LazyAutoClass {}
const generatedLazyLayout = layouts.find((layout) => layout.name === "LazyAuto");
assert.equal(typeof generatedRuntime[generatedLazyLayout.abi.parse], "function");
assert.equal(typeof generatedRuntime[generatedLazyLayout.abi.serialize], "function");
const generatedLazy = generatedRuntime[generatedLazyLayout.abi.parse]('{"id":7,"name":"generated","position":{"x":2,"y":3},"samples":[4,5],"forced":"yes"}', LazyAutoClass);
assert.ok(generatedLazy instanceof LazyAutoClass);
assert.equal(generatedLazy.id, 7);
assert.equal(generatedLazy.name, "generated");
assert.deepEqual(generatedLazy.samples, [4, 5]);
assert.equal(generatedRuntime[generatedLazyLayout.abi.serialize](generatedLazy), '{"id":7,"name":"generated","position":{"x":2,"y":3},"samples":[4,5],"forced":"yes"}');
generatedLazy.dispose();
const generatedDefaultsLayout = layouts.find((layout) => layout.name === "CompositeDefaults");
const generatedDefaults = generatedRuntime[generatedDefaultsLayout.abi.parse]("{}");
assert.deepEqual(generatedDefaults.samples, [1, 2]);
assert.deepEqual(generatedDefaults.position, { x: 3, y: 4 });
generatedDefaults.samples.push(8);
generatedDefaults.position.x = 9;
assert.equal(
  generatedRuntime[generatedDefaultsLayout.abi.serialize](generatedDefaults),
  '{"samples":[1,2,8],"position":{"x":9,"y":4},"matrix":[[5],[6,7]]}',
);
const generatedDefaultsSecond = generatedRuntime[generatedDefaultsLayout.abi.parse]("{}");
assert.deepEqual(generatedDefaultsSecond.samples, [1, 2], "composite defaults are cloned per document");
assert.deepEqual(generatedDefaultsSecond.position, { x: 3, y: 4 });
generatedDefaults.dispose();
generatedDefaultsSecond.dispose();
const generatedPlayerLayout = layouts.find((layout) => layout.name === "Player");
const observedSlot = Symbol("observed-active");
class DecoratedPlayer {}
Object.defineProperty(DecoratedPlayer.prototype, "active", {
  configurable: true,
  enumerable: true,
  get() { return this[observedSlot]; },
  set(value) { this[observedSlot] = !value; },
});
const decoratedPlayer = generatedRuntime[generatedPlayerLayout.abi.parse](
  '{"display name":"decorated","samples":[],"matrix":[],"active":false,"age":20,"tuple":[1,"x",true]}',
  DecoratedPlayer,
);
assert.ok(decoratedPlayer instanceof DecoratedPlayer);
assert.equal(decoratedPlayer.active, true, "unknown property decorators retain their host setter behavior");
decoratedPlayer.dispose();
const generatedConfigLayout = layouts.find((layout) => layout.name === "Config");
const omittedConfig = generatedRuntime[generatedConfigLayout.abi.parse](
  '{"role":0,"defaultRole":1,"state":"on","mode":"fast","box":{"value":2},"pet":{"kind":"cat","lives":9},"hidden":3}',
);
assert.equal(
  generatedRuntime[generatedConfigLayout.abi.serialize](omittedConfig),
  '{"role":0,"defaultRole":1,"state":"on","mode":"fast","box":{"value":2},"pet":{"kind":"cat","lives":9}}',
  "compiled @omitif predicates stay in the generated Wasm serializer",
);
omittedConfig.dispose();
const retainedConfig = generatedRuntime[generatedConfigLayout.abi.parse](
  '{"role":1,"defaultRole":1,"state":"off","mode":"safe","box":{"value":4},"pet":{"kind":"dog","good":true},"hidden":7}',
);
assert.match(generatedRuntime[generatedConfigLayout.abi.serialize](retainedConfig), /"hidden":7/);
retainedConfig.dispose();
const schemas = createSchemaRegistry(layouts);
const runtime = new RawNodeBinding(readFileSync(first.wasmPath), { scratchCapacity: 1 << 20, heapReserve: 1 << 20 });
const Player = schemas.get("Player");
const value = runtime.parse(Player, '{"display name":"test","position":{"x":1,"y":2},"samples":[3,4],"matrix":[[1,2],[3]],"active":false,"age":12,"tuple":[1,"x",true]}');
assert.equal(value.name, "test");
assert.deepEqual(value.samples, [3, 4]);
assert.deepEqual(value.matrix, [[1, 2], [3]]);
assert.equal(value.position.y, 2);
assert.equal(runtime.stringify(Player, value), '{"display name":"test","position":{"x":1,"y":2},"samples":[3,4],"matrix":[[1,2],[3]],"active":false,"tuple":[1,"x",true]}');
value.dispose();

const LazyAuto = schemas.get("LazyAuto");
const lazy = runtime.parse(LazyAuto, '{"id":1,"name":"deferred string","position":{"x":2,"y":3},"samples":[4,5],"forced":"eager string"}');
const lazyRecord = lazy.__document + runtime.u32[(lazy.__document + 12) >>> 2];
const lazyWord = () => runtime.u32[(lazyRecord + LazyAuto.lazyOffset) >>> 2];
const samplesField = LazyAuto.fields.find((field) => field.name === "samples");
const positionField = LazyAuto.fields.find((field) => field.name === "position");
assert.ok((lazyWord() & (1 << samplesField.index)) !== 0, "auto mode defers expensive arrays");
assert.equal(lazyWord() & (1 << positionField.index), 0, "auto mode keeps tiny scalar records eager");
let lazyCalls = 0;
const materializeLazyAuto = runtime.exports.materializeLazyAutoField;
runtime._materializers.set("LazyAuto", (...arguments_) => {
  lazyCalls++;
  return materializeLazyAuto(...arguments_);
});
assert.equal(lazy.id, 1);
assert.equal(lazy.name, "deferred string");
assert.equal(lazy.position.y, 3);
assert.equal(lazyCalls, 0, "eager fields and UTF-8 string spans need no materializer call");
assert.deepEqual(lazy.samples, [4, 5]);
assert.deepEqual(lazy.samples, [4, 5]);
assert.equal(lazyCalls, 1, "first deferred array read materializes once");
assert.equal(lazyWord() & (1 << samplesField.index), 0);
lazy.dispose();

const PlayerArray = schemas.get("PlayerArray");
const values = runtime.parse(PlayerArray, '[{"display name":"a","samples":[1],"matrix":[[1]],"active":true,"age":20,"tuple":[1,"x",false]}]');
assert.ok(Array.isArray(values));
assert.equal(values[0].name, "a");
values.push({ name: "b", samples: [], matrix: [[], [2, 3]], active: false, age: 20, tuple: [2, "y", true] });
assert.equal(runtime.stringify(PlayerArray, values), '[{"display name":"a","samples":[1],"matrix":[[1]],"active":true,"age":20,"tuple":[1,"x",false]},{"display name":"b","samples":[],"matrix":[[],[2,3]],"active":false,"age":20,"tuple":[2,"y",true]}]');
values.dispose();
assert.throws(() => values[0].name, ReferenceError);

const NumberArray = schemas.get("numberArray");
const numbers = runtime.parse(NumberArray, "[1,2.5,-3]");
assert.deepEqual(numbers, [1, 2.5, -3]);
numbers[1] = 4;
assert.equal(runtime.stringify(NumberArray, numbers), "[1,4,-3]");
numbers.dispose();

const NumberFacade = schemas.get("numberJsonArray");
const numberFacade = runtime.parse(NumberFacade, "[3,4,5]");
assert.equal(numberFacade.at(1), 4);
numberFacade.set(1, 9);
assert.equal(runtime.stringify(NumberFacade, numberFacade), "[3,9,5]");
numberFacade.dispose();

console.log("json-tyc build/cache integration: all tests passed");
