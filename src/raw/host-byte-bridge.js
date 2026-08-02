const PAGE_SIZE = 64 * 1024;
const INPUT_RAW = 0;
const INPUT_JSON = 1;
const INPUT_ROOT_VALUE = 2;
const ROOT_PREFIX = new Uint8Array([0x7b, 0x22, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x3a]);

export { INPUT_JSON, INPUT_RAW, INPUT_ROOT_VALUE };

export function createTextHostByteCodec() {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const asciiDecoder = new TextDecoder("ascii");
  const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
  let lastTarget = null;
  let lastOffset = 0;
  let lastCapacity = 0;
  let lastDestination = null;
  return {
    memoryView: () => null,
    byteLength: (value) => encoder.encode(value).byteLength,
    write(value, target, offset, capacity) {
      if (target !== lastTarget || offset !== lastOffset || capacity !== lastCapacity) {
        lastTarget = target;
        lastOffset = offset;
        lastCapacity = capacity;
        lastDestination = target.subarray(offset, offset + capacity);
      }
      const result = encoder.encodeInto(value, lastDestination);
      if (result.read !== value.length) throw new RangeError("UTF-8 destination capacity was exhausted");
      return result.written;
    },
    decode: (target, start, end) => decoder.decode(target.subarray(start, end)),
    decodeAscii: (target, start, end) => asciiDecoder.decode(target.subarray(start, end)),
    decodeFatal: (value) => fatalDecoder.decode(value),
    copy(value, target, offset) {
      target.set(value, offset);
    },
  };
}

export function createNodeHostByteCodec(BufferClass) {
  if (BufferClass === undefined) return createTextHostByteCodec();
  const fatalDecoder = new TextDecoder("utf-8", { fatal: true });
  return {
    memoryView: (buffer) => BufferClass.from(buffer),
    byteLength: (value) => BufferClass.byteLength(value, "utf8"),
    write: (value, _target, offset, capacity, memoryView) => memoryView.write(value, offset, capacity, "utf8"),
    decode: (_target, start, end, memoryView) => memoryView.toString("utf8", start, end),
    decodeAscii: (_target, start, end, memoryView) => memoryView.toString("ascii", start, end),
    decodeFatal: (value) => fatalDecoder.decode(value),
    copy(value, target, offset, memoryView) {
      if (BufferClass.isBuffer(value)) value.copy(memoryView, offset);
      else target.set(value, offset);
    },
  };
}

/**
 * Owns memory views, UTF-8 ingress/egress, resident scratch state, growth, and
 * the private root-value envelope shared by the Node and browser adapters.
 */
export class HostByteBridge {
  constructor(runtime, codec) {
    this.runtime = runtime;
    this.codec = codec;
    this.scratchInputValid = false;
    this.scratchInputMode = INPUT_RAW;
    this.scratchInputString = null;
    this.scratchInputSource = null;
    this.scratchInputLength = 0;
    this.refreshViews();
  }

  refreshViews() {
    const buffer = this.runtime.memory.buffer;
    this.runtime.buffer = this.codec.memoryView(buffer);
    this.runtime.u8 = new Uint8Array(buffer);
    this.runtime.u32 = new Uint32Array(buffer);
    this.runtime.f64 = new Float64Array(buffer);
  }

  byteLength(value) {
    return this.codec.byteLength(value);
  }

  writeUtf8(value, offset, capacity) {
    return this.codec.write(value, this.runtime.u8, offset, capacity, this.runtime.buffer);
  }

  decodeUtf8(start, end) {
    return this.codec.decode(this.runtime.u8, start, end, this.runtime.buffer);
  }

  decodeAscii(start, end) {
    return this.codec.decodeAscii(this.runtime.u8, start, end, this.runtime.buffer);
  }

  decodeFatal(value) {
    return this.codec.decodeFatal(value);
  }

  ensureBytes(requiredBytes) {
    if (requiredBytes <= this.runtime.memory.buffer.byteLength) return;
    const pages = Math.ceil((requiredBytes - this.runtime.memory.buffer.byteLength) / PAGE_SIZE);
    this.runtime.memory.grow(pages);
    this.refreshViews();
    this.runtime.exports.setHeapLimit(this.runtime.memory.buffer.byteLength);
  }

  result(offset) {
    return this.runtime.u32[(this.runtime.control + offset) >>> 2] >>> 0;
  }

  callWithMemoryRefresh(operation, ...arguments_) {
    const previous = this.runtime.memory.buffer;
    const result = operation(...arguments_);
    if (this.runtime.memory.buffer !== previous) this.refreshViews();
    return result;
  }

  invalidateScratchInput() {
    if (!this.scratchInputValid) return;
    this.scratchInputValid = false;
    this.scratchInputString = null;
    this.scratchInputSource = null;
  }

  writeInput(input, requireEchoSpace = false, mode = INPUT_RAW, escapeJson = (value) => value) {
    const { runtime } = this;
    let length;
    if (typeof input === "string") {
      if (this.scratchInputValid && this.scratchInputMode === mode && this.scratchInputString === input) {
        if (requireEchoSpace && ((runtime.scratch + this.scratchInputLength + 7) & ~7) + this.scratchInputLength > runtime.scratch + runtime.scratchCapacity) {
          throw new RangeError("Input and output exceed operation scratch capacity");
        }
        return this.scratchInputLength;
      }
      const source = input;
      if (mode === INPUT_JSON) input = escapeJson(input);
      if (input.length * 3 > runtime.scratchCapacity) {
        const exact = this.byteLength(input);
        if (exact > runtime.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      }
      length = this.writeUtf8(input, runtime.scratch, runtime.scratchCapacity);
      this.scratchInputValid = true;
      this.scratchInputMode = mode;
      this.scratchInputString = source;
      this.scratchInputSource = input;
      this.scratchInputLength = length;
    } else if (input instanceof Uint8Array) {
      this.invalidateScratchInput();
      length = input.byteLength;
      if (length > runtime.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      this.codec.copy(input, runtime.u8, runtime.scratch, runtime.buffer);
    } else {
      throw new TypeError("Expected a string, Buffer, or Uint8Array");
    }
    if (requireEchoSpace && ((runtime.scratch + length + 7) & ~7) + length > runtime.scratch + runtime.scratchCapacity) {
      throw new RangeError("Input and output exceed operation scratch capacity");
    }
    return length;
  }

  writeRootValueInput(input, escapeJson = (value) => value) {
    const { runtime } = this;
    if (typeof input === "string" && this.scratchInputValid && this.scratchInputMode === INPUT_ROOT_VALUE && this.scratchInputString === input) {
      return this.scratchInputLength;
    }

    const source = input;
    let length;
    if (typeof input === "string") {
      input = escapeJson(input);
      if (input.length * 3 + 10 > runtime.scratchCapacity) {
        const exact = this.byteLength(input);
        if (exact + 10 > runtime.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      }
      length = this.writeUtf8(input, runtime.scratch + 9, runtime.scratchCapacity - 10);
      this.scratchInputValid = true;
      this.scratchInputMode = INPUT_ROOT_VALUE;
      this.scratchInputString = source;
      this.scratchInputSource = input;
      this.scratchInputLength = length + 10;
    } else if (input instanceof Uint8Array) {
      this.invalidateScratchInput();
      length = input.byteLength;
      if (length + 10 > runtime.scratchCapacity) throw new RangeError("Input exceeds operation scratch capacity");
      this.codec.copy(input, runtime.u8, runtime.scratch + 9, runtime.buffer);
    } else {
      throw new TypeError("Expected a string, Buffer, or Uint8Array");
    }

    runtime.u8.set(ROOT_PREFIX, runtime.scratch);
    runtime.u8[runtime.scratch + 9 + length] = 0x7d;
    return length + 10;
  }
}
