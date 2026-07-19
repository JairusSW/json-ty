const number = { kind: "number" };
const string = { kind: "string" };
const boolean = { kind: "boolean" };
const object = (typeName) => ({ kind: "object", typeName });
const array = (element) => ({ kind: "array", element, facade: "array" });
const field = (name, type) => ({ name, kind: type.kind, type });

export const paritySchemas = [
  { name: "ParityVec3", fields: [field("x", number), field("y", number), field("z", number)] },
  {
    name: "ParityAddr",
    fields: [field("street", string), field("city", string), field("region", string), field("zip", string), field("country", string)],
  },
  {
    name: "ParitySmall",
    fields: [field("id", number), field("name", string), field("active", boolean), field("email", string)],
  },
  {
    name: "ParityMedium",
    fields: [
      field("id", number),
      field("name", string),
      field("email", string),
      field("bio", string),
      field("addr", object("ParityAddr")),
      field("tags", array(string)),
      field("scores", array(number)),
      field("active", boolean),
      field("created", string),
      field("updated", string),
    ],
  },
  {
    name: "ParityLarge",
    fields: [
      field("id", number),
      field("uuid", string),
      field("name", string),
      field("email", string),
      field("bio", string),
      field("homepage", string),
      field("avatar", string),
      field("addr", object("ParityAddr")),
      field("billing", object("ParityAddr")),
      field("tags", array(string)),
      field("scores", array(number)),
      field("followers", array(number)),
      field("active", boolean),
      field("verified", boolean),
      field("plan", string),
      field("created", string),
      field("updated", string),
      field("note", string),
    ],
  },
];
