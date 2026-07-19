const addr = {
  street: "742 Evergreen Terrace",
  city: "Springfield",
  region: "OR",
  zip: "97477",
  country: "United States",
};

export const parityPayloads = [
  { key: "vec3", schema: "ParityVec3", value: { x: 1, y: 2, z: 3 } },
  { key: "small", schema: "ParitySmall", value: { id: 8472, name: "jairus", active: true, email: "me@jairus.dev" } },
  {
    key: "medium",
    schema: "ParityMedium",
    value: {
      id: 8472,
      name: "Jairus Tanaka",
      email: "me@jairus.dev",
      bio: "Systems and compiler engineer working on AssemblyScript tooling.",
      addr,
      tags: ["assemblyscript", "json", "simd", "wasm", "performance"],
      scores: [98, 72, 64, 51, 89, 77],
      active: true,
      created: "2025-01-02T03:04:05Z",
      updated: "2025-12-23T04:30:00Z",
    },
  },
  {
    key: "large",
    schema: "ParityLarge",
    value: {
      id: 8472,
      uuid: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      name: "Jairus Tanaka",
      email: "me@jairus.dev",
      bio: "Systems and compiler engineer working on AssemblyScript tooling, JSON serialization, and SIMD-accelerated parsers for WebAssembly runtimes.",
      homepage: "https://jairus.dev",
      avatar: "https://avatars.githubusercontent.com/u/583231?v=4",
      addr,
      billing: { ...addr },
      tags: ["assemblyscript", "json", "simd", "swar", "wasm", "performance", "compilers", "serde"],
      scores: [98, 72, 64, 51, 89, 77, 33, 41, 95, 60],
      followers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      active: true,
      verified: true,
      plan: "enterprise",
      created: "2025-01-02T03:04:05Z",
      updated: "2025-12-23T04:30:00Z",
      note: "All systems nominal; payload intentionally padded to a few kilobytes for the large case.",
    },
  },
].map((payload) => {
  const json = JSON.stringify(payload.value);
  return { ...payload, json, bytes: Buffer.byteLength(json) };
});
