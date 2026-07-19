const number = { kind: "number" };
const boolean = { kind: "boolean" };
const string = { kind: "string" };
const object = (typeName) => ({ kind: "object", typeName });
const array = (element) => ({ kind: "array", element, facade: "array" });
const field = (name, type) => ({ name, kind: type.kind, type });

export const overviewSchemas = [
  {
    name: "Vec3",
    fields: [field("x", number), field("y", number), field("z", number)],
  },
  {
    name: "Token",
    fields: [field("id", number), field("token", string)],
  },
  {
    name: "Small",
    fields: [field("id", number), field("name", string), field("email", string), field("active", boolean), field("score", number)],
  },
  {
    name: "Preferences",
    fields: [field("theme", string), field("locale", string), field("notifications", boolean)],
  },
  {
    name: "MediumUser",
    fields: [field("id", number), field("name", string), field("email", string), field("active", boolean), field("preferences", object("Preferences"))],
  },
  {
    name: "Activity",
    fields: [field("id", number), field("action", string), field("timestamp", number), field("successful", boolean)],
  },
  {
    name: "Medium",
    fields: [field("status", string), field("requestId", string), field("user", object("MediumUser")), field("recentActivity", array(object("Activity")))],
  },
  {
    name: "RepoOwner",
    fields: [field("id", number), field("login", string), field("avatarUrl", string), field("htmlUrl", string)],
  },
  {
    name: "Repository",
    fields: [field("id", number), field("name", string), field("fullName", string), field("private", boolean), field("owner", object("RepoOwner")), field("htmlUrl", string), field("description", string), field("fork", boolean), field("createdAt", string), field("updatedAt", string), field("pushedAt", string), field("gitUrl", string), field("sshUrl", string), field("cloneUrl", string), field("size", number), field("stargazersCount", number), field("watchersCount", number), field("language", string), field("hasIssues", boolean), field("hasProjects", boolean), field("hasDownloads", boolean), field("hasWiki", boolean), field("hasPages", boolean), field("forksCount", number), field("archived", boolean), field("disabled", boolean), field("openIssuesCount", number), field("topics", array(string)), field("visibility", string), field("defaultBranch", string)],
  },
  {
    name: "Large",
    fields: [field("totalCount", number), field("incompleteResults", boolean), field("repositories", array(object("Repository")))],
  },
];
