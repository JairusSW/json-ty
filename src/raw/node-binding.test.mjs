import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RawNodeBinding, bindSchemaClass, createObjectView, createSchemaRegistry } from "./node-binding.js";
import { JSON as JsonTy } from "../index.js";

const wasmBytes = readFileSync("build/raw/runtime.wasm");
const runtime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 1 << 20,
});

for (const value of ["", "plain ASCII JSON bytes", '{"name":"café €17 😀","ok":true}', 'line one\nline two\t\\quoted"']) {
  assert.equal(runtime.echo(value), value);
}

const bytes = Buffer.from('{"buffer":true,"n":42}', "utf8");
assert.equal(runtime.echo(bytes), bytes.toString("utf8"));
assert.equal(runtime.echo(new Uint8Array(bytes)), bytes.toString("utf8"));

const first = runtime.commit("first persistent document");
const second = runtime.commit("second persistent document");
assert.equal(runtime.read(first.pointer, first.length), "first persistent document");
assert.equal(runtime.read(second.pointer, second.length), "second persistent document");

runtime.release(first.pointer);
const reused = runtime.commit("replacement");
assert.equal(reused.pointer, first.pointer);
assert.equal(runtime.read(reused.pointer, reused.length), "replacement");
assert.equal(runtime.read(second.pointer, second.length), "second persistent document");

runtime.release(reused.pointer);
assert.throws(() => runtime.release(reused.pointer), /status 1/);
runtime.release(second.pointer);

const layouts = JSON.parse(readFileSync("build/raw/schema-layouts.json", "utf8"));
const metricLayout = layouts.find((layout) => layout.name === "Metric");
const MetricView = createObjectView(metricLayout);
const Metric = { ...metricLayout, View: MetricView };
const residentSource = '{"id":11,"value":2.5,"label":"resident","ok":true}';
const residentFirst = runtime.parse(Metric, residentSource);
const residentSecond = runtime.parse(Metric, residentSource);
assert.notEqual(residentFirst.__document, residentSecond.__document);
assert.equal(residentSecond.label, "resident");
residentFirst.dispose();
residentSecond.dispose();

const invalidatedSource = runtime.parse(Metric, residentSource);
assert.equal(runtime.stringify(Metric, invalidatedSource), residentSource);
invalidatedSource.dispose();
const reparsedAfterOutput = runtime.parse(Metric, residentSource);
assert.equal(reparsedAfterOutput.id, 11);
reparsedAfterOutput.dispose();

const interveningBuffer = runtime.parse(Metric, Buffer.from('{"id":29,"label":"buffer"}'));
assert.equal(interveningBuffer.id, 29);
interveningBuffer.dispose();
const reparsedAfterBuffer = runtime.parse(Metric, residentSource);
assert.equal(reparsedAfterBuffer.label, "resident");
reparsedAfterBuffer.dispose();

for (const source of ['{"label":"first"}', '{"label":"second"}', '{"label":"first"}']) {
  const alternating = runtime.parse(Metric, source);
  assert.equal(alternating.label, JSON.parse(source).label);
  alternating.dispose();
}
const metric = runtime.parse(Metric, '{ "label":"cpu\\nuser", "ok":true, "extra":[1,{"x":2}], "id":7, "value":3.5 }');
assert.equal(metric.id, 7);
assert.equal(metric.value, 3.5);
assert.equal(metric.label, "cpu\nuser");
assert.equal(metric.label, "cpu\nuser");
assert.equal(metric.ok, true);
assert.equal(runtime.stringify(Metric, metric), '{"id":7,"value":3.5,"label":"cpu\\nuser","ok":true}');
metric.dispose();
metric.dispose();
assert.throws(() => metric.id, ReferenceError);
assert.throws(() => runtime.stringify(Metric, metric), ReferenceError);

const partial = runtime.parse(Metric, '{"label":"x","id":-0}');
assert.equal(runtime.stringify(Metric, partial), '{"id":0,"label":"x"}');
partial.id = 42;
partial.label = "changed\nvalue";
partial.ok = false;
assert.equal(partial.id, 42);
assert.equal(partial.label, "changed\nvalue");
assert.equal(runtime.stringify(Metric, partial), '{"id":42,"label":"changed\\nvalue","ok":false}');
partial.label = undefined;
assert.equal(runtime.stringify(Metric, partial), '{"id":42,"ok":false}');
assert.throws(() => {
  partial.id = null;
}, TypeError);
partial.dispose();

// Exact ordered input is eligible for retained-source serialization. A field
// mutation must clear that document flag before the generated writer runs.
const canonicalMetric = runtime.parse(Metric, '{"id":7,"value":3.5,"label":"x","ok":true}');
assert.equal(runtime.stringify(Metric, canonicalMetric), '{"id":7,"value":3.5,"label":"x","ok":true}');
canonicalMetric.id = 8;
assert.equal(runtime.stringify(Metric, canonicalMetric), '{"id":8,"value":3.5,"label":"x","ok":true}');
canonicalMetric.dispose();

runtime.objectShape = "enumerable";
const enumerableMetric = runtime.parse(Metric, '{"id":1,"label":"visible"}');
assert.deepEqual(Object.keys(enumerableMetric), ["id", "label"]);
assert.deepEqual({ ...enumerableMetric }, { id: 1, label: "visible" });
enumerableMetric.ok = true;
assert.deepEqual(Object.keys(enumerableMetric), ["id", "label", "ok"]);
enumerableMetric.label = undefined;
assert.deepEqual(Object.keys(enumerableMetric), ["id", "ok"]);
enumerableMetric.dispose();
runtime.objectShape = "view";

const numberCases = [1e-7, 0.000001, 1e20, 1e21, Number.MIN_VALUE, Number.MAX_VALUE, 9007199254740991];
for (const value of numberCases) {
  const view = runtime.parse(Metric, `{"value":${JSON.stringify(value)}}`);
  assert.equal(runtime.stringify(Metric, view), `{"value":${JSON.stringify(value)}}`);
  view.dispose();
}

const ordinary = { id: -0, value: Number.POSITIVE_INFINITY, label: 'café\n"x"', ok: false, extra: 1 };
const ordinaryExpected = '{"id":0,"value":null,"label":"café\\n\\"x\\"","ok":false}';
assert.equal(runtime.stringifyJS(Metric, ordinary), JSON.stringify(ordinary));
assert.equal(runtime.stringifyWasm(Metric, ordinary), ordinaryExpected);
assert.equal(runtime.stringify(Metric, ordinary), JSON.stringify(ordinary));
assert.equal(runtime.stringifyWasm(Metric, { id: 1 }), '{"id":1}');

const loneSurrogate = runtime.parse(Metric, '{"label":"\ud800"}');
assert.equal(loneSurrogate.label, "\ud800");
assert.equal(runtime.stringify(Metric, loneSurrogate), '{"label":"\\ud800"}');
loneSurrogate.dispose();
const repeatedLoneSurrogate = runtime.parse(Metric, '{"label":"\ud800"}');
assert.equal(repeatedLoneSurrogate.label, "\ud800");
repeatedLoneSurrogate.dispose();

const invalidUtf8 = Buffer.concat([Buffer.from('{"label":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}')]);
assert.throws(() => runtime.parse(Metric, invalidUtf8), SyntaxError);

const defaultsLayout = layouts.find((layout) => layout.name === "Defaults");
const Defaults = { ...defaultsLayout, View: createObjectView(defaultsLayout) };
const defaults = runtime.parse(Defaults, "{}");
const defaultsRecord = defaults.__document + runtime.u32[(defaults.__document + 12) >>> 2];
assert.equal(runtime.u32[defaultsRecord >>> 2], 0, "missing default fields stay implicit in the delta record");
assert.equal(defaults.count, 7);
assert.equal(defaults.active, true);
assert.equal(defaults.label, 'a"x');
assert.equal(defaults.note, null);
assert.equal(runtime.stringify(Defaults, defaults), '{"count":7,"active":true,"display label":"a\\"x"}');
defaults.dispose();

const exactDefaults = runtime.parse(Defaults, '{"count":7,"active":true,"display label":"a\\"x"}');
const exactDefaultsRecord = exactDefaults.__document + runtime.u32[(exactDefaults.__document + 12) >>> 2];
assert.equal(runtime.u32[exactDefaultsRecord >>> 2], 0, "exact default documents bypass field parsing");
assert.equal(runtime.u32[(exactDefaults.__document + 8) >>> 2] & 0x0fffffff, 0, "default fast path retains no input bytes");
exactDefaults.dispose();

const decorated = runtime.parse(Defaults, '{"display label":"renamed","note":"yes","secret":"hidden"}');
assert.equal(decorated.label, "renamed");
assert.equal(decorated.note, "yes");
assert.equal(decorated.secret, "hidden");
assert.equal(runtime.stringify(Defaults, decorated), '{"count":7,"active":true,"display label":"renamed","note":"yes"}');
decorated.dispose();

const registry = createSchemaRegistry(layouts);
const LazyRecord = registry.get("LazyRecord");
const lazySource = '{"values":[1,2.5,3],"nullable":null,"child":{"label":"kid","id":7},"name":"repo","enabled":false,"count":42,"childEager":{"id":9,"label":"eager"},"id":1}';
const lazyExpected = '{"id":1,"count":42,"enabled":false,"name":"repo","child":{"label":"kid","id":7},"values":[1,2.5,3],"childEager":{"id":9,"label":"eager"},"nullable":null}';
const lazyView = runtime.parse(LazyRecord, lazySource);
const lazyRoot = lazyView.__document + runtime.u32[(lazyView.__document + 12) >>> 2];
const lazyWord = () => runtime.u32[(lazyRoot + LazyRecord.lazyOffset) >>> 2];
const lazyMask = (name) => 1 << LazyRecord.fields.find((field) => field.name === name).index;
assert.ok((lazyWord() & lazyMask("count")) !== 0);
assert.ok((lazyWord() & lazyMask("enabled")) !== 0);
assert.ok((lazyWord() & lazyMask("child")) !== 0);
assert.ok((lazyWord() & lazyMask("values")) !== 0);
assert.equal(lazyWord() & lazyMask("childEager"), 0);
assert.equal(lazyWord() & lazyMask("nullable"), 0);

let lazyMaterializations = 0;
const materializeLazyRecord = runtime.exports.materializeLazyRecordField;
runtime._materializers.set("LazyRecord", (...args) => {
  lazyMaterializations++;
  return materializeLazyRecord(...args);
});
assert.equal(lazyView.id, 1); // eager scalar
assert.equal(lazyView.name, "repo"); // strings already decode lazily on host
assert.equal(lazyMaterializations, 0);
assert.equal(runtime.stringify(LazyRecord, lazyView), lazyExpected); // untouched ranges pass through
assert.equal(lazyView.count, 42);
assert.equal(lazyView.count, 42);
assert.equal(lazyMaterializations, 1); // materialized once, then cached in the flat slot
assert.equal(lazyWord() & lazyMask("count"), 0);
assert.equal(lazyView.enabled, false);
assert.equal(lazyView.child.id, 7);
assert.equal(lazyMaterializations, 3);
assert.equal(lazyView.childEager.id, 9);
assert.equal(lazyMaterializations, 3);
assert.equal(lazyView.nullable, null);
assert.equal(lazyMaterializations, 3);
assert.deepEqual(lazyView.values, [1, 2.5, 3]);
assert.equal(lazyMaterializations, 4);
lazyView.values.push(4);
lazyView.child.id = 8;
assert.equal(runtime.stringify(LazyRecord, lazyView), '{"id":1,"count":42,"enabled":false,"name":"repo","child":{"id":8,"label":"kid"},"values":[1,2.5,3,4],"childEager":{"id":9,"label":"eager"},"nullable":null}');
lazyView.dispose();

const lazySetBeforeRead = runtime.parse(LazyRecord, lazySource);
lazySetBeforeRead.count = 99;
assert.equal(lazySetBeforeRead.count, 99);
assert.equal(runtime.stringify(LazyRecord, lazySetBeforeRead), lazyExpected.replace('"count":42', '"count":99'));
lazySetBeforeRead.dispose();

const lazyWrongShape = runtime.parse(LazyRecord, Buffer.from('{"child":5}'));
assert.equal(runtime.stringify(LazyRecord, lazyWrongShape), '{"child":5}');
assert.throws(() => lazyWrongShape.child, SyntaxError); // schema work is genuinely deferred
lazyWrongShape.dispose();

const lazyPrettyNested = runtime.parse(LazyRecord, '{"id":1,"count":2,"enabled":true,"name":"x","child":{"id": 3, "label": "pretty"},"values":[],"childEager":{"id":4,"label":"eager"},"nullable":null}');
assert.equal(lazyPrettyNested.child.label, "pretty", "ordered lazy scan falls back for internal whitespace");
lazyPrettyNested.dispose();
assert.throws(
  () => runtime.parse(LazyRecord, Buffer.from('{"id":1,"count":2,"enabled":true,"name":"x","child":{"id":3,},"values":[],"childEager":{"id":4,"label":"eager"},"nullable":null}')),
  SyntaxError,
  "deferral postpones schema conversion, never JSON grammar validation",
);

class MetricClass {
  total() {
    return this.id + this.value;
  }
}
const ClassMetric = bindSchemaClass(registry.get("Metric"), MetricClass);
const classMetric = runtime.parse(ClassMetric, '{"id":2,"value":3,"label":"class","ok":true}');
assert.ok(classMetric instanceof MetricClass);
assert.equal(classMetric.total(), 5);
classMetric.dispose();
class ObservedMetric {
  set ok(value) {
    this.observedOk = value;
  }
  get ok() {
    return this.observedOk;
  }
}
const observedLayout = {
  ...metricLayout,
  name: "Metric",
  fields: metricLayout.fields.map((field) => (field.name === "ok" ? { ...field, hostManaged: true } : { ...field })),
};
const observedRegistry = createSchemaRegistry([observedLayout]);
const ObservedMetricSchema = bindSchemaClass(observedRegistry.get("Metric"), ObservedMetric);
const observedMetric = runtime.parse(ObservedMetricSchema, '{"id":1,"value":2,"label":"decorated","ok":true}');
assert.ok(observedMetric instanceof ObservedMetric);
assert.equal(observedMetric.ok, true);
assert.equal(runtime.stringify(ObservedMetricSchema, observedMetric), '{"id":1,"value":2,"label":"decorated","ok":true}');
observedMetric.dispose();
const Player = registry.get("Player");
const playerInput = '{"sampleView":[10,20,30],"matrix":[[1,2],[3]],"tags":["a","b\\nc"],"positions":[{"x":9,"y":8}],"flags":[true,false],"samples":[1,2.5,-3],"position":{"y":4,"x":3},"name":"Ada"}';
const cachedPlayer = runtime.parse(Player, playerInput);
const cachedPlayerOutput = runtime.stringify(Player, cachedPlayer);
assert.strictEqual(runtime.stringify(Player, cachedPlayer), cachedPlayerOutput);
cachedPlayer.position.x = 99;
assert.match(runtime.stringify(Player, cachedPlayer), /"position":\{"x":99,"y":4\}/);
cachedPlayer.sampleView.set(0, 11);
assert.match(runtime.stringify(Player, cachedPlayer), /"sampleView":\[11,20,30\]/);
cachedPlayer.dispose();
const player = runtime.parse(Player, playerInput);
assert.equal(player.name, "Ada");
assert.equal(player.position.x, 3);
assert.equal(player.position.y, 4);
assert.ok(player.position instanceof registry.get("Position").View);
assert.ok(Array.isArray(player.samples));
assert.deepEqual(player.samples, [1, 2.5, -3]);
assert.strictEqual(player.samples, player.samples);
assert.deepEqual(player.flags, [true, false]);
assert.deepEqual(player.tags, ["a", "b\nc"]);
assert.equal(player.positions[0].x, 9);
assert.deepEqual(player.matrix, [[1, 2], [3]]);
assert.equal(Array.isArray(player.sampleView), false);
assert.equal(player.sampleView.length, 3);
assert.equal(player.sampleView.at(-1), 30);
assert.equal(runtime.stringify(Player, player), '{"name":"Ada","position":{"x":3,"y":4},"samples":[1,2.5,-3],"flags":[true,false],"tags":["a","b\\nc"],"positions":[{"x":9,"y":8}],"matrix":[[1,2],[3]],"sampleView":[10,20,30]}');

player.name = "Grace";
player.position.x = 10;
player.samples.push(7);
player.tags[0] = "changed\tvalue";
player.positions[0].y = 11;
player.matrix[1].push(4);
player.sampleView.set(1, 25);
assert.equal(runtime.stringify(Player, player), '{"name":"Grace","position":{"x":10,"y":4},"samples":[1,2.5,-3,7],"flags":[true,false],"tags":["changed\\tvalue","b\\nc"],"positions":[{"x":9,"y":11}],"matrix":[[1,2],[3,4]],"sampleView":[10,25,30]}');
const retainedPosition = player.position;
player.dispose();
assert.throws(() => retainedPosition.x, ReferenceError);

const plainPlayer = {
  name: "plain",
  position: null,
  samples: [1, 2],
  flags: [false],
  tags: ["x\ny"],
  positions: [{ x: 5, y: 6 }],
  matrix: [[7], [8, 9]],
  sampleView: [4, 5],
};
assert.equal(runtime.stringifyWasm(Player, plainPlayer), '{"name":"plain","position":null,"samples":[1,2],"flags":[false],"tags":["x\\ny"],"positions":[{"x":5,"y":6}],"matrix":[[7],[8,9]],"sampleView":[4,5]}');

const Tree = registry.get("Tree");
const tree = runtime.parse(Tree, '{"value":1,"children":[{"value":2,"children":[]},{"value":3,"children":[{"value":4,"children":[]}]}]}');
assert.equal(tree.children[1].children[0].value, 4);
assert.equal(runtime.stringify(Tree, tree), '{"value":1,"children":[{"value":2,"children":[]},{"value":3,"children":[{"value":4,"children":[]}]}]}');
tree.dispose();

const TupleHolder = registry.get("TupleHolder");
const tupleHolder = runtime.parse(TupleHolder, '{"value":[1.5,"tuple",true,{"x":7,"y":8}]}');
assert.equal(tupleHolder.value[0], 1.5);
assert.equal(tupleHolder.value[1], "tuple");
assert.equal(tupleHolder.value[2], true);
assert.equal(tupleHolder.value[3].y, 8);
assert.equal(runtime.stringify(TupleHolder, tupleHolder), '{"value":[1.5,"tuple",true,{"x":7,"y":8}]}');
tupleHolder.dispose();
assert.throws(() => runtime.parse(TupleHolder, '{"value":[1,"short"]}'), SyntaxError);

const PetHolder = registry.get("PetHolder");
const pets = runtime.parse(PetHolder, '{"pets":[{"good":true,"kind":"dog"},{"kind":"cat","lives":9}],"pet":{"lives":7,"kind":"cat"}}');
assert.ok(pets.pet instanceof registry.get("Cat").View);
assert.equal(pets.pet.lives, 7);
assert.ok(pets.pets[0] instanceof registry.get("Dog").View);
assert.equal(pets.pets[0].good, true);
assert.equal(pets.pets[1].lives, 9);
assert.equal(runtime.stringify(PetHolder, pets), '{"pet":{"kind":"cat","lives":7},"pets":[{"kind":"dog","good":true},{"kind":"cat","lives":9}]}');
pets.dispose();
assert.throws(() => runtime.parse(PetHolder, '{"pet":{"kind":"bird"},"pets":[]}'), SyntaxError);

const dynamicInput = '{"name":"café","items":[1,true,null,{"x":"a\\nb"}],"wide":{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"h":8},"dup":1,"dup":2}';
const dynamic = runtime.parseDynamic(dynamicInput);
assert.equal(dynamic.type, "object");
assert.equal(dynamic.get("name").value, "café");
assert.equal(dynamic.get("items").at(1).value, true);
assert.equal(dynamic.get("items").at(2).value, null);
assert.equal(dynamic.get("items").at(3).get("x").value, "a\nb");
assert.equal(dynamic.get("wide").get("h").value, 8);
assert.equal(dynamic.get("dup").value, 2);
assert.equal(dynamic.stringify(), dynamicInput);
assert.deepEqual(dynamic.toObject(), JSON.parse(dynamicInput));
const dynamicChild = dynamic.get("items");
dynamic.dispose();
assert.throws(() => dynamicChild.length, ReferenceError);

assert.deepEqual(runtime.parseDynamic(Buffer.from('[5e-324,{"ok":false}]'), { plain: true }), [5e-324, { ok: false }]);
assert.equal(runtime.stringifyDynamic({ raw: new JsonTy.Raw('{"kept":[1,true]}'), boxed: new Number(4) }), '{"raw":{"kept":[1,true]},"boxed":4}');
const [RawHolder] = createSchemaRegistry([
  {
    name: "RawHolder",
    recordSize: 16,
    nativeStringifyCompatible: false,
    fields: [
      {
        name: "payload",
        jsonName: "payload",
        kind: "string",
        type: { kind: "string" },
        index: 0,
        offset: 8,
        decorators: { raw: true },
      },
    ],
  },
]).values();
assert.equal(runtime.stringify(RawHolder, { payload: new JsonTy.Raw('{"kept":[1,true]}') }), '{"payload":{"kept":[1,true]}}');
for (const invalidDynamic of ["[1,]", '{"x" 1}', "[1}", "truth"]) {
  assert.throws(() => runtime.parseDynamic(invalidDynamic), SyntaxError);
}

const growthRuntime = new RawNodeBinding(wasmBytes, {
  scratchCapacity: 1 << 20,
  heapReserve: 64 << 10,
});
const beforeGrowth = growthRuntime.memory.buffer.byteLength;
const largeValue = "x".repeat(256 << 10);
const grownDocument = growthRuntime.commit(largeValue);
assert.ok(growthRuntime.memory.buffer.byteLength > beforeGrowth);
assert.equal(growthRuntime.read(grownDocument.pointer, grownDocument.length), largeValue);
growthRuntime.release(grownDocument.pointer);

for (const invalid of ['{"id":01,"value":2,"label":"x","ok":true}', '{"id":1,"value":2,"label":"unterminated,"ok":true}', '{"id":1,"value":2,"label":"x","ok":truth}', '{"id":1,"value":2,"label":"x","ok":true} trailing', '{"id":1,"extra":[1}}', '{"id":1,"extra":{"x" 1}}', '{"id":1,"extra":[1,]}']) {
  assert.throws(() => runtime.parse(Metric, invalid), SyntaxError);
}

console.log("raw Node binding: all tests passed");
