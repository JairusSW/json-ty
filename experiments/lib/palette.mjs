// Chart palette — ported from json-as scripts/lib/palette.ts (same author, MIT).
// Single source of truth for every benchmark chart's colours.

export const BASE = {
  jungleGreen: "#44AF69",
  fadedCopper: "#9E7153",
  strawberryRed: "#F8333C",
  atomicTangerine: "#FA6F26",
  orange: "#FCAB10",
  palmLeaf: "#94A562",
  pacificBlue: "#2B9EB3",
  mutedTeal: "#83BAB4",
  sandDune: "#DBD5B5",
};

const RGB = {
  jungleGreen: "68,175,105",
  fadedCopper: "158,113,83",
  strawberryRed: "248,51,60",
  atomicTangerine: "250,111,38",
  orange: "252,171,16",
  palmLeaf: "148,165,98",
  pacificBlue: "43,158,179",
  mutedTeal: "131,186,180",
  sandDune: "219,213,181",
};

export const rgba = (name, alpha = 1) => `rgba(${RGB[name]},${alpha})`;

// JS → strawberry red · NAIVE → orange · SWAR → jungle green · SIMD → pacific blue
export const MODE_BARS = [
  { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
  { bg: rgba("orange", 0.85), border: BASE.orange },
  { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
  { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
];

export const OBJ_BAR = { bg: rgba("fadedCopper", 0.85), border: BASE.fadedCopper };
export const EAGER = { bg: rgba("sandDune", 0.85), border: BASE.sandDune };
export const LAZY = { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen };

// Convenience: a {bg,border} pair from any BASE hue.
export const bar = (name, alpha = 0.85) => ({ bg: rgba(name, alpha), border: BASE[name] });

export const INK = {
  subtitle: "#6b7280",
  label: "#374151",
  grid: "rgba(0,0,0,0.08)",
};
