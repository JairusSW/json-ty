const RGB = {
  jungleGreen: "68,175,105",
  fadedCopper: "158,113,83",
  strawberryRed: "248,51,60",
  orange: "252,171,16",
  pacificBlue: "43,158,179",
};

const rgba = (name, alpha = 1) => `rgba(${RGB[name]},${alpha})`;

export const BASE = {
  jungleGreen: "#44AF69",
  fadedCopper: "#9E7153",
  strawberryRed: "#F8333C",
  orange: "#FCAB10",
  pacificBlue: "#2B9EB3",
};

// Keep the json-as overview order: baseline, fallback, scalar/plain, fastest,
// then the opt-in dynamic object representation.
export const OVERVIEW_BARS = [
  { bg: rgba("strawberryRed", 0.85), border: BASE.strawberryRed },
  { bg: rgba("orange", 0.85), border: BASE.orange },
  { bg: rgba("jungleGreen", 0.85), border: BASE.jungleGreen },
  { bg: rgba("pacificBlue", 0.9), border: BASE.pacificBlue },
  { bg: rgba("fadedCopper", 0.85), border: BASE.fadedCopper },
];

export const INK = {
  subtitle: "#6b7280",
  label: "#374151",
  grid: "rgba(0,0,0,0.08)",
};
