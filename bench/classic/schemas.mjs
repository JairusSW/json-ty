const number = { kind: "number" };
const string = { kind: "string" };
const object = (typeName) => ({ kind: "object", typeName });
const array = (element) => ({ kind: "array", element, facade: "array" });
const jsonArray = (element) => ({ kind: "array", element, facade: "json-array" });
const field = (name, type) => ({ name, kind: type.kind, type });
const lazyField = (name, type) => ({ ...field(name, type), decorators: { lazy: true } });

// These are the classic schemas that the bootstrap IR can represent exactly.
// Keep this list honest: projection-only schemas must not be added here because
// the eager and serialization results are intended to cover the entire value.
export const classicSchemas = [
  {
    name: "CanadaProperties",
    fields: [field("name", string)],
  },
  {
    name: "CanadaGeometry",
    fields: [field("type", string), field("coordinates", array(array(array(number))))],
  },
  {
    name: "CanadaFeature",
    fields: [field("type", string), field("properties", object("CanadaProperties")), field("geometry", object("CanadaGeometry"))],
  },
  {
    name: "Canada",
    fields: [field("type", string), field("features", array(object("CanadaFeature")))],
  },
  {
    name: "CanadaPropertiesLazy",
    fields: [field("name", string)],
  },
  {
    name: "CanadaGeometryLazy",
    fields: [field("type", string), lazyField("coordinates", array(array(array(number))))],
  },
  {
    name: "CanadaFeatureLazy",
    fields: [field("type", string), field("properties", object("CanadaPropertiesLazy")), field("geometry", object("CanadaGeometryLazy"))],
  },
  {
    name: "CanadaLazy",
    fields: [field("type", string), field("features", array(object("CanadaFeatureLazy")))],
  },
  {
    name: "Poem",
    fields: [field("desc", string), field("name", string), field("id", string)],
  },
  {
    name: "PoemArray",
    root: "array",
    fields: [field("value", jsonArray(object("Poem")))],
  },
];
