import { createHash } from "node:crypto";
export const SCHEMA_IR_VERSION = 5;
export function layoutObject(schema) {
    if (!/^[$A-Z_a-z][$\w]*$/.test(schema.name)) {
        throw new Error(`Invalid schema name ${JSON.stringify(schema.name)}`);
    }
    const bitmapWords = Math.max(1, Math.ceil(schema.fields.length / 32));
    const nullOffset = bitmapWords * 4;
    const fieldOffset = bitmapWords * 8;
    const seen = new Set();
    const fields = schema.fields.map((field, index) => {
        const jsonName = field.jsonName ?? field.name;
        if (seen.has(jsonName))
            throw new Error(`Duplicate JSON field ${JSON.stringify(jsonName)}`);
        seen.add(jsonName);
        const type = field.type ?? { kind: field.kind };
        return { ...field, type, jsonName, index, offset: fieldOffset + index * 8 };
    });
    const hasDeferredFields = fields.some((field) => field.decorators?.lazy && field.kind !== "string");
    const fieldsEnd = fieldOffset + fields.length * 8;
    const lazyOffset = hasDeferredFields ? fieldsEnd : undefined;
    const recordEnd = fieldsEnd + (hasDeferredFields ? bitmapWords * 4 : 0);
    const recordSize = (recordEnd + 7) & ~7;
    const hasDefaults = fields.some((field) => field.defaultValue !== undefined);
    const canMatchDefaultDocument = hasDefaults && fields.every((field) => !field.hostManaged && !field.decorators?.omitIf && !field.decorators?.raw && !field.decorators?.codec);
    const hasOptionalShape = fields.some((field) => field.optional || field.defaultValue !== undefined || field.decorators?.optional);
    const retainsSource = fields.some((field) => field.kind === "string" || field.decorators?.lazy);
    const fullWrite = fields.length !== 0 && fields.every((field) => !field.optional && field.defaultValue === undefined && !field.decorators?.optional);
    return {
        name: schema.name,
        ...(schema.root ? { root: schema.root } : {}),
        bitmapWords,
        nullOffset,
        fieldOffset,
        fields,
        ...(lazyOffset === undefined ? {} : { lazyOffset }),
        recordSize,
        nativeStringifyCompatible: fields.every((field) => field.jsonName === field.name && !field.decorators?.omit && !field.decorators?.omitNull && !field.decorators?.omitIf && !field.decorators?.raw && !field.decorators?.codec),
        features: {
            deserialize: {
                defaultDocument: canMatchDefaultDocument,
                canonical: fields.length !== 0,
                canonicalOptional: hasOptionalShape,
                whitespace: fields.length !== 0,
                keyed: fields.length !== 0,
                slow: true,
                ...(fields.length > 32 && fields.every((field) => field.kind === "number" || field.kind === "boolean" || field.kind === "string")
                    ? { chunkSize: 32 }
                    : {}),
            },
            retainsSource,
            hasLazyFields: hasDeferredFields,
            fullWrite,
            simdKeys: fields.some((field) => new TextEncoder().encode(field.jsonName).length >= 8),
            defaults: hasDefaults ? "delta" : "none",
        },
    };
}
export function canonicalizeSchemas(schemas) {
    return [...schemas]
        .map((schema) => ({
        ...schema,
        fields: schema.fields.map((field) => ({ ...field })),
    }))
        .sort((left, right) => left.name.localeCompare(right.name));
}
export function createSchemaManifest(schemas) {
    const canonical = canonicalizeSchemas(schemas);
    const semanticSchemas = canonical.map(({ sourceFile: _sourceFile, ...schema }) => schema);
    const payload = JSON.stringify({ version: SCHEMA_IR_VERSION, schemas: semanticSchemas });
    return {
        version: SCHEMA_IR_VERSION,
        schemas: canonical,
        hash: createHash("sha256").update(payload).digest("hex"),
    };
}
