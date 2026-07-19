// Compatibility barrel for generated artifacts created before the type-kernel
// layout. New code imports serialize/writer directly.
export {
  beginWriter,
  finishWriter,
  requiredWriterCapacity,
  writeByte,
  writeF64,
  writePacked,
  writeRaw,
} from "./serialize/writer";
