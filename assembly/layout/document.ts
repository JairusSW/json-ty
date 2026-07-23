// Stable flat document layout shared by generated schemas and core kernels.
// All pointers stored inside a document are u32 offsets relative to its base.

export const DOCUMENT_HEADER_SIZE: usize = 16;
export const DOCUMENT_SIZE_OFFSET: usize = 0;
export const DOCUMENT_SOURCE_OFFSET: usize = 4;
export const DOCUMENT_SOURCE_LENGTH_OFFSET: usize = 8;
export const DOCUMENT_ROOT_OFFSET: usize = 12;
export const DOCUMENT_CANONICAL_SOURCE: u32 = 0x80000000;
export const DOCUMENT_CANDIDATE_SOURCE: u32 = 0x40000000;
export const DOCUMENT_BORROWED_SOURCE: u32 = 0x20000000;
export const DOCUMENT_EXTERNAL_OUTPUT: u32 = 0x10000000;
export const DOCUMENT_SOURCE_LENGTH_MASK: u32 = 0x0fffffff;

@inline
export function documentRoot(document: usize): usize {
  return document + <usize>load<u32>(document + DOCUMENT_ROOT_OFFSET);
}

@inline
export function documentSource(document: usize): usize {
  return document + <usize>load<u32>(document + DOCUMENT_SOURCE_OFFSET);
}

@inline
export function documentSourceLength(document: usize): u32 {
  return load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET) & DOCUMENT_SOURCE_LENGTH_MASK;
}

@inline
export function documentSourceIsCanonical(document: usize): bool {
  return (load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET) & DOCUMENT_CANONICAL_SOURCE) != 0;
}

@inline
export function documentSourceIsCandidate(document: usize): bool {
  return (load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET) & DOCUMENT_CANDIDATE_SOURCE) != 0;
}

@inline
export function markDocumentSourceCandidate(document: usize): void {
  store<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET, load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET) | DOCUMENT_CANDIDATE_SOURCE);
}

@inline
export function clearDocumentSourceCandidate(document: usize): void {
  store<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET, load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET) & ~DOCUMENT_CANDIDATE_SOURCE);
}

@inline
export function markDocumentSourceCanonical(document: usize): void {
  const value = load<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET);
  store<u32>(document + DOCUMENT_SOURCE_LENGTH_OFFSET, (value & ~DOCUMENT_CANDIDATE_SOURCE) | DOCUMENT_CANONICAL_SOURCE);
}

/** Bounded byte equality used once to promote a candidate source to canonical. */
export function documentSourceEquals(document: usize, output: usize, length: u32): bool {
  if (length != documentSourceLength(document)) return false;
  const source = documentSource(document);
  let offset: usize = 0;
  const end = <usize>length;
  if (ASC_FEATURE_SIMD) {
    while (offset + 16 <= end) {
      if (v128.any_true(v128.xor(v128.load(source + offset), v128.load(output + offset)))) return false;
      offset += 16;
    }
  }
  while (offset + 8 <= end) {
    if (load<u64>(source + offset) != load<u64>(output + offset)) return false;
    offset += 8;
  }
  while (offset < end) {
    if (load<u8>(source + offset) != load<u8>(output + offset)) return false;
    offset++;
  }
  return true;
}

@inline
export function storeDocumentHeader(document: usize, size: u32, sourceOffset: u32, sourceLength: u32, rootOffset: u32, flags: u32 = 0): void {
  store<u64>(document + DOCUMENT_SIZE_OFFSET, <u64>size | (<u64>sourceOffset << 32));
  store<u64>(document + DOCUMENT_SOURCE_LENGTH_OFFSET, <u64>(sourceLength | flags) | (<u64>rootOffset << 32));
}
