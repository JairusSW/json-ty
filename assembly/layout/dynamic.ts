export const DYNAMIC_NULL: u32 = 0;
export const DYNAMIC_BOOLEAN: u32 = 1;
export const DYNAMIC_NUMBER: u32 = 2;
export const DYNAMIC_STRING: u32 = 3;
export const DYNAMIC_ARRAY: u32 = 4;
export const DYNAMIC_OBJECT: u32 = 5;
/** Validated source spans whose container graph has not been built yet. */
export const DYNAMIC_LAZY_ARRAY: u32 = 6;
export const DYNAMIC_LAZY_OBJECT: u32 = 7;

// Packed tagged value: u32 tag followed by an 8-byte payload. Every embedded
// slot is placed so the payload remains naturally aligned for f64 loads.
export const DYNAMIC_SLOT_SIZE: usize = 12;
export const DYNAMIC_SLOT_PAYLOAD_OFFSET: usize = 4;
export const DYNAMIC_SLOT_AUX_OFFSET: usize = 8;
export const DYNAMIC_ARRAY_ENTRY_SIZE: usize = 16;
export const DYNAMIC_ARRAY_SLOT_OFFSET: usize = 4;
export const DYNAMIC_ENTRY_SIZE: usize = 24;
export const DYNAMIC_ENTRY_NEXT_OFFSET: usize = 8;
export const DYNAMIC_ENTRY_SLOT_OFFSET: usize = 12;

// Dynamic documents extend the shared 16-byte header with a persistent arena
// cursor and limit. The source follows this extension; the shared root/source
// accessors remain unchanged.
export const DYNAMIC_DOCUMENT_HEADER_SIZE: usize = 24;
export const DYNAMIC_GRAPH_CURSOR_OFFSET: usize = 16;
export const DYNAMIC_GRAPH_LIMIT_OFFSET: usize = 20;
