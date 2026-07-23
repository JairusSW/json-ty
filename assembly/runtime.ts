// Raw json-ty memory substrate.
//
// This module deliberately uses no AssemblyScript managed values. JavaScript
// imports and owns the WebAssembly memory, while this module manages a fixed
// operation scratch region and explicitly releasable persistent blocks.

const RESULT_STATUS: usize = 0;
const RESULT_FAULT: usize = 4;
const RESULT_ROOT: usize = 8;
const RESULT_DOCUMENT: usize = 12;
const RESULT_DOCUMENT_LENGTH: usize = 16;
const RESULT_OUTPUT: usize = 20;
const RESULT_OUTPUT_LENGTH: usize = 24;
const RESULT_REQUIRED: usize = 28;

const STATUS_OK: u32 = 0;
const STATUS_INVALID_STATE: u32 = 1;
const STATUS_SCRATCH_EXHAUSTED: u32 = 2;
const STATUS_MEMORY_EXHAUSTED: u32 = 3;

const BLOCK_HEADER_SIZE: usize = 8;
const MIN_SPLIT_SIZE: usize = 24;
const BLOCK_ALLOCATED: u32 = 0x80000000;
const BLOCK_SIZE_MASK: u32 = 0x7fffffff;
const DOCUMENT_EXTERNAL_OUTPUT: u32 = 0x10000000;

let resultPtr: usize = 0;
let scratchPtr: usize = 0;
let scratchSize: usize = 0;
let heapBase: usize = 0;
let heapLimit: usize = 0;
let heapBump: usize = 0;
let freeHead: usize = 0;
let initialized: bool = false;


@inline
function align8(value: usize): usize {
  return (value + 7) & ~(<usize>7);
}


@inline
function clearResult(): void {
  memory.fill(resultPtr, 0, 32);
}

export function resetResult(): void {
  clearResult();
}


@inline
function setStatus(status: u32, required: usize = 0): void {
  store<u32>(resultPtr + RESULT_STATUS, status);
  store<u32>(resultPtr + RESULT_REQUIRED, <u32>required);
}

export function failResult(status: u32, faultOffset: u32, required: u32): u32 {
  store<u32>(resultPtr + RESULT_STATUS, status);
  store<u32>(resultPtr + RESULT_FAULT, faultOffset);
  store<u32>(resultPtr + RESULT_REQUIRED, required);
  return 0;
}

export function setResultRoot(root: u32): void {
  store<u32>(resultPtr + RESULT_ROOT, root);
}

export function setResultOutput(output: u32, length: u32): u32 {
  store<u32>(resultPtr + RESULT_STATUS, STATUS_OK);
  store<u32>(resultPtr + RESULT_OUTPUT, output);
  store<u32>(resultPtr + RESULT_OUTPUT_LENGTH, length);
  return STATUS_OK;
}

function allocateBlock(payloadSize: usize, reuseFreeBlocks: bool = true): usize {
  if (!initialized) {
    setStatus(STATUS_INVALID_STATE);
    return 0;
  }

  // The high bit in a block header is the allocation flag. Reject sizes whose
  // aligned payload and header would consume it instead of truncating the size
  // and corrupting the free list.
  if (payloadSize > <usize>BLOCK_SIZE_MASK - BLOCK_HEADER_SIZE - 7) {
    setStatus(STATUS_MEMORY_EXHAUSTED, payloadSize);
    return 0;
  }

  const total = align8(payloadSize) + BLOCK_HEADER_SIZE;
  let block: usize = 0;
  if (reuseFreeBlocks) {
    let previous: usize = 0;
    block = freeHead;

    while (block != 0) {
      const blockSize = <usize>(load<u32>(block) & BLOCK_SIZE_MASK);
      const next = <usize>load<u32>(block + 4);
      if (blockSize >= total) {
        const remainder = blockSize - total;
        if (remainder >= MIN_SPLIT_SIZE) {
          const split = block + total;
          store<u32>(split, <u32>remainder);
          store<u32>(split + 4, <u32>next);
          if (previous == 0) freeHead = split;
          else store<u32>(previous + 4, <u32>split);
          store<u32>(block, (<u32>total) | BLOCK_ALLOCATED);
        } else {
          if (previous == 0) freeHead = next;
          else store<u32>(previous + 4, <u32>next);
        }
        if (remainder < MIN_SPLIT_SIZE) store<u32>(block, (<u32>blockSize) | BLOCK_ALLOCATED);
        store<u32>(block + 4, 0);
        return block + BLOCK_HEADER_SIZE;
      }
      previous = block;
      block = next;
    }
  }

  const end = heapBump + total;
  if (end > heapLimit || end < heapBump) {
    setStatus(STATUS_MEMORY_EXHAUSTED, end);
    return 0;
  }

  block = heapBump;
  heapBump = end;
  store<u32>(block, (<u32>total) | BLOCK_ALLOCATED);
  store<u32>(block + 4, 0);
  return block + BLOCK_HEADER_SIZE;
}

export function initialize(control: u32, scratch: u32, scratchCapacity: u32, persistentBase: u32, persistentLimit: u32): u32 {
  resultPtr = <usize>control;
  scratchPtr = <usize>scratch;
  scratchSize = <usize>scratchCapacity;
  heapBase = align8(<usize>persistentBase);
  heapLimit = <usize>persistentLimit;
  heapBump = heapBase;
  freeHead = 0;
  initialized = resultPtr != 0 && scratchPtr >= resultPtr + 32 && scratchSize != 0 && scratchPtr + scratchSize <= heapBase && heapBase < heapLimit;
  clearResult();
  if (!initialized) {
    setStatus(STATUS_INVALID_STATE);
    return STATUS_INVALID_STATE;
  }
  return STATUS_OK;
}

export function setHeapLimit(limit: u32): void {
  heapLimit = <usize>limit;
}

export function resultHeader(): u32 {
  return <u32>resultPtr;
}

export function operationScratch(): u32 {
  return <u32>scratchPtr;
}

export function operationScratchCapacity(): u32 {
  return <u32>scratchSize;
}

export function operationScratchEnd(): u32 {
  return <u32>(scratchPtr + scratchSize);
}

export function persistentHeapBase(): u32 {
  return <u32>heapBase;
}

export function persistentHeapTop(): u32 {
  return <u32>heapBump;
}

export function allocateDocument(size: u32): u32 {
  clearResult();
  const document = allocateBlock(<usize>size);
  if (document == 0) return 0;
  store<u32>(resultPtr + RESULT_STATUS, STATUS_OK);
  store<u32>(resultPtr + RESULT_DOCUMENT, <u32>document);
  store<u32>(resultPtr + RESULT_DOCUMENT_LENGTH, size);
  return <u32>document;
}

/**
 * Allocate at the allocator wilderness so the document can subsequently grow
 * without moving and invalidating its relative pointers.
 */
export function allocateGrowableDocument(size: u32): u32 {
  clearResult();
  const document = allocateBlock(<usize>size, false);
  if (document == 0) return 0;
  store<u32>(resultPtr + RESULT_STATUS, STATUS_OK);
  store<u32>(resultPtr + RESULT_DOCUMENT, <u32>document);
  store<u32>(resultPtr + RESULT_DOCUMENT_LENGTH, size);
  return <u32>document;
}

/**
 * Grow the newest allocator-owned document without moving it.
 *
 * Dynamic parsing is stack-shaped, so its in-progress document normally owns
 * the wilderness block. Geometric growth avoids a full structural sizing pass
 * while keeping reservation bounded by roughly twice committed graph bytes.
 * Returns the new payload capacity, or zero when the block cannot grow in
 * place or linear memory cannot grow.
 */
function growDocumentTo(document: u32, minimumSize: u32, geometric: bool): u32 {
  if (!initialized || document < heapBase + BLOCK_HEADER_SIZE) {
    setStatus(STATUS_INVALID_STATE);
    return 0;
  }
  const block = <usize>document - BLOCK_HEADER_SIZE;
  const sizeWord = load<u32>(block);
  if ((sizeWord & BLOCK_ALLOCATED) == 0) {
    setStatus(STATUS_INVALID_STATE);
    return 0;
  }
  const blockSize = <usize>(sizeWord & BLOCK_SIZE_MASK);
  if (block + blockSize != heapBump) {
    setStatus(STATUS_MEMORY_EXHAUSTED, minimumSize);
    return 0;
  }

  const currentPayload = blockSize - BLOCK_HEADER_SIZE;
  // A 6.25% step bounds peak slack without putting a sizing prepass on eager's
  // hot path. Even the densest classic graph needs only a handful of grows.
  let nextPayload = geometric
    ? currentPayload + (currentPayload >> 4)
    : <usize>minimumSize;
  if (nextPayload < <usize>minimumSize) nextPayload = <usize>minimumSize;
  if (nextPayload > <usize>BLOCK_SIZE_MASK - BLOCK_HEADER_SIZE - 7) {
    setStatus(STATUS_MEMORY_EXHAUSTED, nextPayload);
    return 0;
  }
  const nextTotal = align8(nextPayload) + BLOCK_HEADER_SIZE;
  const nextEnd = block + nextTotal;
  if (nextEnd < block) {
    setStatus(STATUS_MEMORY_EXHAUSTED, nextEnd);
    return 0;
  }
  if (nextEnd > heapLimit) {
    const missing = nextEnd - heapLimit;
    const pages = <i32>((missing + 0xffff) >> 16);
    if (memory.grow(pages) < 0) {
      setStatus(STATUS_MEMORY_EXHAUSTED, nextEnd);
      return 0;
    }
    heapLimit = <usize>memory.size() << 16;
  }

  heapBump = nextEnd;
  store<u32>(block, <u32>nextTotal | BLOCK_ALLOCATED);
  return <u32>(nextTotal - BLOCK_HEADER_SIZE);
}

export function growDocument(document: u32, minimumSize: u32): u32 {
  return growDocumentTo(document, minimumSize, true);
}

/** Reserve an exact final capacity after a fused validation/sizing pass. */
export function reserveDocument(document: u32, minimumSize: u32): u32 {
  return growDocumentTo(document, minimumSize, false);
}

export function releaseDocument(document: u32): u32 {
  if (!initialized) return STATUS_INVALID_STATE;
  // Caller-owned parseInto documents carry no allocator block. Releasing one
  // is intentionally a no-op so the same document ABI works for owned and
  // externally supplied output buffers. Validate the complete header shape:
  // commitBytes also accepts arbitrary payloads, whose bytes at +8 must never
  // be mistaken for document flags.
  const documentPointer = <usize>document;
  const memoryLimit = <usize>memory.size() << 16;
  if (
    documentPointer >= scratchPtr &&
    documentPointer <= memoryLimit - 16
  ) {
    const documentLength = <usize>load<u32>(documentPointer);
    const recordOffset = <usize>load<u32>(documentPointer + 12);
    if (
      (load<u32>(documentPointer + 8) & DOCUMENT_EXTERNAL_OUTPUT) != 0 &&
      documentLength >= 16 &&
      recordOffset >= 16 &&
      recordOffset <= documentLength &&
      documentLength <= memoryLimit - documentPointer
    ) return STATUS_OK;
  }
  if (document < heapBase + BLOCK_HEADER_SIZE || document >= heapBump) {
    return STATUS_INVALID_STATE;
  }
  const block = <usize>document - BLOCK_HEADER_SIZE;
  const sizeWord = load<u32>(block);
  if ((sizeWord & BLOCK_ALLOCATED) == 0) return STATUS_INVALID_STATE;
  const blockSize = <usize>(sizeWord & BLOCK_SIZE_MASK);
  if (blockSize < BLOCK_HEADER_SIZE || block + blockSize > heapBump) return STATUS_INVALID_STATE;

  // The overwhelmingly common parse/use/release lifecycle is stack-shaped.
  // Reclaim the wilderness block by moving the bump pointer instead of
  // inserting it into, then immediately splitting it from, the free list.
  if (block + blockSize == heapBump && freeHead == 0) {
    heapBump = block;
    return STATUS_OK;
  }

  if (freeHead == 0) {
    store<u32>(block, <u32>blockSize);
    store<u32>(block + 4, 0);
    freeHead = block;
    return STATUS_OK;
  }

  // Keep the free list address-sorted so adjacent blocks can be coalesced in
  // constant time once their insertion point is known.
  let previous: usize = 0;
  let next = freeHead;
  while (next != 0 && next < block) {
    previous = next;
    next = <usize>load<u32>(next + 4);
  }
  if (next == block) return STATUS_INVALID_STATE;

  let mergedSize = blockSize;
  if (next != 0 && block + mergedSize == next) {
    mergedSize += <usize>(load<u32>(next) & BLOCK_SIZE_MASK);
    next = <usize>load<u32>(next + 4);
  }
  store<u32>(block, <u32>mergedSize);
  store<u32>(block + 4, <u32>next);

  if (previous == 0) {
    freeHead = block;
  } else {
    const previousSize = <usize>(load<u32>(previous) & BLOCK_SIZE_MASK);
    if (previous + previousSize == block) {
      store<u32>(previous, <u32>(previousSize + mergedSize));
      store<u32>(previous + 4, <u32>next);
    } else {
      store<u32>(previous + 4, <u32>block);
    }
  }

  // Coalescing may have produced a free wilderness region. Remove it from the
  // list and roll the bump pointer back even when lower-address holes remain.
  let tailPrevious: usize = 0;
  let tail = freeHead;
  while (tail != 0) {
    const tailNext = <usize>load<u32>(tail + 4);
    const tailSize = <usize>(load<u32>(tail) & BLOCK_SIZE_MASK);
    if (tail + tailSize == heapBump) {
      heapBump = tail;
      if (tailPrevious == 0) freeHead = tailNext;
      else store<u32>(tailPrevious + 4, <u32>tailNext);
      break;
    }
    tailPrevious = tail;
    tail = tailNext;
  }
  return STATUS_OK;
}

// Commit arbitrary bytes into an independently owned persistent block. This is
// the primitive the parser will use after producing a relative-offset graph in
// scratch.
export function commitBytes(source: u32, length: u32): u32 {
  clearResult();
  const src = <usize>source;
  const len = <usize>length;
  if (!initialized || src < scratchPtr || src + len > scratchPtr + scratchSize) {
    setStatus(STATUS_SCRATCH_EXHAUSTED, src + len);
    return 0;
  }
  const document = allocateBlock(len);
  if (document == 0) return 0;
  memory.copy(document, src, len);
  store<u32>(resultPtr + RESULT_STATUS, STATUS_OK);
  store<u32>(resultPtr + RESULT_ROOT, 0);
  store<u32>(resultPtr + RESULT_DOCUMENT, <u32>document);
  store<u32>(resultPtr + RESULT_DOCUMENT_LENGTH, length);
  return <u32>document;
}

// Raw UTF-8 echo used to validate the custom binding and output ABI before the
// schema parser and writer are connected. The output remains in operation
// scratch and is valid until the next operation.
export function echoBytes(source: u32, length: u32): u32 {
  clearResult();
  const src = <usize>source;
  const len = <usize>length;
  const output = align8(src + len);
  const scratchEnd = scratchPtr + scratchSize;
  if (!initialized || src < scratchPtr || src + len > scratchEnd || output + len > scratchEnd) {
    setStatus(STATUS_SCRATCH_EXHAUSTED, output + len);
    return STATUS_SCRATCH_EXHAUSTED;
  }
  memory.copy(output, src, len);
  store<u32>(resultPtr + RESULT_STATUS, STATUS_OK);
  store<u32>(resultPtr + RESULT_OUTPUT, <u32>output);
  store<u32>(resultPtr + RESULT_OUTPUT_LENGTH, length);
  return STATUS_OK;
}

export function resultStatus(): u32 {
  return load<u32>(resultPtr + RESULT_STATUS);
}

export function resultFaultOffset(): u32 {
  return load<u32>(resultPtr + RESULT_FAULT);
}
