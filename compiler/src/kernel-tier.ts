/** Compile-time JSON kernel families. No tier is selected at Wasm runtime. */
export const KERNEL_TIERS = ["naive", "swar", "simd"] as const;

export type KernelTier = typeof KERNEL_TIERS[number];

/** SWAR is the portable optimized default; SIMD remains an explicit opt-in. */
export const DEFAULT_KERNEL_TIER: KernelTier = "swar";

export function resolveKernelTier(value: string | undefined): KernelTier {
  if (value === undefined) return DEFAULT_KERNEL_TIER;
  if ((KERNEL_TIERS as readonly string[]).includes(value)) return value as KernelTier;
  throw new Error(
    `Invalid json-ty kernel tier ${JSON.stringify(value)}; expected ${KERNEL_TIERS.join(", ")}`,
  );
}
