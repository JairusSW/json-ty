export const JSON = {
  Raw: class Raw {
    [Symbol.for("json-ty.raw")] = true;
    constructor(value) {
      globalThis.JSON.parse(value);
      this.value = value;
    }
    toString() {
      return this.value;
    }
  },
  from(constructor, value) {
    return Object.assign(new constructor(), value);
  },
  schema() {},
  parse(data) {
    const source = typeof data === "string" ? data : new TextDecoder().decode(data);
    return globalThis.JSON.parse(source);
  },
  stringify(data) {
    return globalThis.JSON.stringify(data);
  },
  dispose(value) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
    const method = value.dispose;
    if (typeof method === "function") method.call(value);
  },
};

export function json(targetOrOptions) {
  return typeof targetOrOptions === "function" ? targetOrOptions : ((value) => value);
}
export const serializable = json;
const propertyMarker = () => {};
export const alias = () => propertyMarker;
export function omit(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export function omitnull(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export function optional(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export function lazy(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export function eager(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export function raw(...args) {
  return args.length >= 2 ? undefined : propertyMarker;
}
export const omitif = () => propertyMarker;
export const codec = () => propertyMarker;
