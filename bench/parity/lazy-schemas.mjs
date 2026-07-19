const number = { kind: "number" };
const string = { kind: "string" };
const boolean = { kind: "boolean" };
const object = (typeName) => ({ kind: "object", typeName });
const array = (element) => ({ kind: "array", element, facade: "array" });
const field = (name, type, lazy) => ({ name, kind: type.kind, type, decorators: { lazy } });

const addrFields = ["street", "city", "region", "zip", "country"].map((name) => field(name, string, true));

export const lazyParitySchemas = [
  { name: "ParityLazyAddr", fields: addrFields },
  {
    name: "ParitySmallLazy",
    fields: [field("id", number, false), field("name", string, true), field("active", boolean, false), field("email", string, true)],
  },
  {
    name: "ParityMediumLazy",
    fields: [
      field("id", number, false),
      field("name", string, true),
      field("email", string, true),
      field("bio", string, true),
      field("addr", object("ParityLazyAddr"), true),
      field("tags", array(string), true),
      field("scores", array(number), true),
      field("active", boolean, false),
      field("created", string, true),
      field("updated", string, true),
    ],
  },
  {
    name: "ParityLargeLazy",
    fields: [
      field("id", number, false),
      field("uuid", string, true),
      field("name", string, true),
      field("email", string, true),
      field("bio", string, true),
      field("homepage", string, true),
      field("avatar", string, true),
      field("addr", object("ParityLazyAddr"), true),
      field("billing", object("ParityLazyAddr"), true),
      field("tags", array(string), true),
      field("scores", array(number), true),
      field("followers", array(number), true),
      field("active", boolean, false),
      field("verified", boolean, false),
      field("plan", string, true),
      field("created", string, true),
      field("updated", string, true),
      field("note", string, true),
    ],
  },
];
