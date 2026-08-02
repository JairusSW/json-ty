import type { HostTypeRef } from "../../schema-ir.js";
import type { AssemblyTypeEmitter } from "./types.js";

/** Host-coded values stay as validated raw spans until JavaScript reads them. */
export const hostEmitter: AssemblyTypeEmitter<HostTypeRef> = {
  kind: "host",
  emitParse(_type, context) {
    return `const hostStart = ${context.cursor};
    const hostEnd = skipValue(hostStart, ${context.end});
    if (hostEnd == 0) ${context.fail("host", context.cursor)}
    store<u32>(${context.destination}, <u32>(hostStart - ${context.document}));
    store<u32>(${context.destination} + 4, <u32>(hostEnd - hostStart));
    ${context.cursor} = hostEnd;`;
  },
  emitSerialize(_type, context) {
    return `if (!writeRaw(<u32>(${context.document} + load<u32>(${context.source})), load<u32>(${context.source} + 4))) ${context.fail}`;
  },
};
