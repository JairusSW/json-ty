const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const uuidv4 = "9f6f9f12-6fc3-4cfa-9b3e-b1e2ca873d06";

function makeMedium() {
  return {
    status: "ok",
    requestId: uuidv4,
    user: {
      id: 719238,
      name: "Ada Lovelace",
      email: "ada@example.com",
      active: true,
      preferences: {
        theme: "dark",
        locale: "en-US",
        notifications: true,
      },
    },
    recentActivity: Array.from({ length: 10 }, (_, index) => ({
      id: 10_000 + index,
      action: index % 2 ? "updated-project" : "viewed-dashboard",
      timestamp: 1_725_000_000 + index * 61,
      successful: index !== 7,
    })),
  };
}

function makeLarge() {
  const repositories = Array.from({ length: 5 }, (_, index) => ({
    id: 91_000_000 + index,
    name: `json-engine-${index}`,
    fullName: `benchmark/json-engine-${index}`,
    private: false,
    owner: {
      id: 42_000 + index,
      login: `benchmark-owner-${index}`,
      avatarUrl: `https://avatars.example.com/u/${42_000 + index}?v=4`,
      htmlUrl: `https://example.com/benchmark-owner-${index}`,
    },
    htmlUrl: `https://example.com/benchmark/json-engine-${index}`,
    description: "A deliberately realistic repository record used to measure nested UTF-8 JSON parsing and serialization throughput.",
    fork: false,
    createdAt: "2024-01-16T08:45:12Z",
    updatedAt: "2026-06-11T19:32:48Z",
    pushedAt: "2026-06-11T19:30:02Z",
    gitUrl: `git://example.com/benchmark/json-engine-${index}.git`,
    sshUrl: `git@example.com:benchmark/json-engine-${index}.git`,
    cloneUrl: `https://example.com/benchmark/json-engine-${index}.git`,
    size: 18_450 + index * 137,
    stargazersCount: 12_000 + index * 431,
    watchersCount: 12_000 + index * 431,
    language: index % 2 ? "AssemblyScript" : "TypeScript",
    hasIssues: true,
    hasProjects: true,
    hasDownloads: true,
    hasWiki: false,
    hasPages: false,
    forksCount: 812 + index,
    archived: false,
    disabled: false,
    openIssuesCount: 17 + index,
    topics: ["json", "wasm", "serialization", "performance", "assemblyscript"],
    visibility: "public",
    defaultBranch: "main",
  }));
  return { totalCount: repositories.length, incompleteResults: false, repositories };
}

const definitions = [
  {
    key: "abc",
    title: "Alphabet",
    schema: null,
    labelBytes: alphabet.length,
    value: alphabet,
  },
  {
    key: "uuidv4",
    title: "UUIDv4",
    schema: null,
    labelBytes: uuidv4.length,
    value: uuidv4,
  },
  { key: "vec3", title: "3D Vector", schema: "Vec3", value: { x: 1, y: 2, z: 3 } },
  {
    key: "token",
    title: "Token",
    schema: "Token",
    value: { id: 256, token: "f83c9a7e1d4b6f29801a73c0a19e" },
  },
  {
    key: "small",
    title: "Small Payload",
    schema: "Small",
    value: {
      id: 42,
      name: "json-ty benchmark payload for run",
      email: "bench@example.com",
      active: true,
      score: 98.25,
    },
  },
  { key: "medium", title: "Medium Payload", schema: "Medium", value: makeMedium() },
  { key: "large", title: "Large Payload", schema: "Large", value: makeLarge() },
];

function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes}b`;
  return `${(bytes / 1000).toFixed(1)}kb`;
}

export const payloads = definitions.map((definition) => {
  const json = JSON.stringify(definition.value);
  const bytes = Buffer.byteLength(json);
  return {
    ...definition,
    json,
    buffer: Buffer.from(json),
    bytes,
    label: `${definition.title}\n   (${formatBytes(definition.labelBytes ?? bytes)})`,
  };
});
