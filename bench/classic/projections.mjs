function unwrap(value) {
  if (value === undefined || value === null) return value;
  if (typeof value.type === "string" && "value" in value) return value.value;
  return value;
}

function get(root, key) {
  if (root === undefined || root === null) return undefined;
  return typeof root.get === "function" ? root.get(key) : root[key];
}

function objectField(root, key) {
  const value = get(root, key);
  if (value?.type === "object") return value;
  const unwrapped = unwrap(value);
  return unwrapped !== null && typeof unwrapped === "object" && !Array.isArray(unwrapped) ? unwrapped : undefined;
}

function arrayField(root, key) {
  const value = get(root, key);
  if (value?.type === "array") return value;
  const unwrapped = unwrap(value);
  return Array.isArray(unwrapped) || (unwrapped && typeof unwrapped.at === "function" && typeof unwrapped.length === "number") ? unwrapped : undefined;
}

function at(array, index) {
  return unwrap(typeof array.at === "function" ? array.at(index) : array[index]);
}

function numberField(root, key) {
  const value = unwrap(get(root, key));
  return typeof value === "number" ? value : 0;
}

function stringField(root, key) {
  const value = unwrap(get(root, key));
  return typeof value === "string" ? value.length : 0;
}

function booleanField(root, key) {
  return unwrap(get(root, key)) === true ? 1 : 0;
}

function values(root) {
  if (root && typeof root.entries === "function" && typeof root.size === "number") {
    return Array.from(root.entries(), ([, value]) => unwrap(value));
  }
  return Object.values(root ?? {});
}

function valueKind(value) {
  if (value?.type) return ["null", "boolean", "number", "string", "array", "object"].indexOf(value.type);
  value = unwrap(value);
  if (value === null) return 0;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 2;
  if (typeof value === "string") return 3;
  if (Array.isArray(value)) return 4;
  return value && typeof value === "object" ? 5 : 0;
}

function canada(root) {
  let sum = stringField(root, "type");
  const features = arrayField(root, "features");
  if (!features) return sum;
  for (let index = 0; index < features.length; index++) {
    const feature = at(features, index);
    sum += stringField(feature, "type");
    const properties = objectField(feature, "properties");
    const geometry = objectField(feature, "geometry");
    if (properties) sum += stringField(properties, "name");
    if (geometry) sum += stringField(geometry, "type");
  }
  return sum;
}

function citm(root) {
  let sum = 0;
  const performances = arrayField(root, "performances");
  if (performances) {
    for (let index = 0; index < performances.length; index++) {
      const performance = at(performances, index);
      sum += numberField(performance, "eventId") + numberField(performance, "id") + numberField(performance, "start");
      sum += stringField(performance, "name") + stringField(performance, "venueCode");
    }
  }
  const events = objectField(root, "events");
  if (events) {
    for (const event of values(events).slice(0, 8)) {
      sum += numberField(event, "id") + stringField(event, "name") + stringField(event, "subjectCode");
    }
  }
  return sum;
}

function github(root) {
  let sum = 0;
  for (let index = 0; index < root.length; index++) {
    const event = at(root, index);
    sum += stringField(event, "type") + stringField(event, "created_at") + stringField(event, "id");
    const actor = objectField(event, "actor");
    const repo = objectField(event, "repo");
    const payload = objectField(event, "payload");
    if (actor) sum += stringField(actor, "login") + numberField(actor, "id");
    if (repo) sum += stringField(repo, "name") + numberField(repo, "id");
    sum += booleanField(event, "public");
    if (payload) {
      sum += stringField(payload, "action") + stringField(payload, "ref") + numberField(payload, "size") + numberField(payload, "distinct_size");
      const issue = objectField(payload, "issue");
      const comment = objectField(payload, "comment");
      if (issue) sum += stringField(issue, "title") + numberField(issue, "id");
      if (comment) sum += stringField(comment, "body") + numberField(comment, "id");
    }
  }
  return sum;
}

function gsoc(root) {
  let sum = 0;
  for (const org of values(root)) {
    sum += stringField(org, "name") + stringField(org, "@type");
    const sponsor = objectField(org, "sponsor");
    const author = objectField(org, "author");
    if (sponsor) sum += stringField(sponsor, "name");
    if (author) sum += stringField(author, "name");
  }
  return sum;
}

function lottieLayer(layer) {
  return stringField(layer, "nm") + numberField(layer, "ty") + numberField(layer, "ip") + numberField(layer, "op") + valueKind(get(layer, "ks")) + valueKind(get(layer, "shapes"));
}

function lottie(root) {
  let sum = stringField(root, "v") + numberField(root, "fr") + numberField(root, "w") + numberField(root, "h") + numberField(root, "op");
  const layers = arrayField(root, "layers");
  if (layers) for (let index = 0; index < layers.length; index++) sum += lottieLayer(at(layers, index));
  const assets = arrayField(root, "assets");
  if (assets) {
    for (let index = 0; index < assets.length; index++) {
      const asset = at(assets, index);
      sum += stringField(asset, "id");
      const assetLayers = arrayField(asset, "layers");
      if (assetLayers) for (let layer = 0; layer < assetLayers.length; layer++) sum += lottieLayer(at(assetLayers, layer));
    }
  }
  return sum;
}

function poet(root) {
  let sum = 0;
  for (let index = 0; index < root.length; index++) {
    const poem = at(root, index);
    sum += stringField(poem, "desc") + stringField(poem, "name") + stringField(poem, "id");
  }
  return sum;
}

function tweet(status) {
  let sum = stringField(status, "created_at") + numberField(status, "id") + stringField(status, "text") + numberField(status, "in_reply_to_status_id");
  const user = objectField(status, "user");
  if (user) sum += numberField(user, "id") + stringField(user, "screen_name");
  return sum + numberField(status, "retweet_count") + numberField(status, "favorite_count");
}

function statuses(root) {
  return arrayField(root, "statuses");
}

function twitter(root) {
  const list = statuses(root);
  let sum = 0;
  if (list) for (let index = 0; index < list.length; index++) sum += tweet(at(list, index));
  return sum;
}

function findTweet(root) {
  const list = statuses(root);
  if (!list) return 0;
  for (let index = 0; index < list.length; index++) {
    const status = at(list, index);
    if (numberField(status, "id") === 505874901689851904) return stringField(status, "text");
  }
  return 0;
}

function topTweet(root) {
  const list = statuses(root);
  let best = -1;
  let bestIndex = -1;
  if (!list) return 0;
  for (let index = 0; index < list.length; index++) {
    const count = numberField(at(list, index), "retweet_count");
    if (count <= 60 && count >= best) {
      best = count;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return 0;
  const status = at(list, bestIndex);
  const user = objectField(status, "user");
  return best + stringField(status, "text") + (user ? stringField(user, "screen_name") : 0);
}

function distinctUserId(root) {
  const list = statuses(root);
  let sum = 0;
  if (!list) return sum;
  for (let index = 0; index < list.length; index++) {
    const status = at(list, index);
    const user = objectField(status, "user");
    const retweetedUser = objectField(objectField(status, "retweeted_status"), "user");
    if (user) sum += numberField(user, "id");
    if (retweetedUser) sum += numberField(retweetedUser, "id");
  }
  return sum;
}

function kinds(root) {
  return values(root).reduce((sum, value) => sum + valueKind(value), 0);
}

export const projections = {
  twitter,
  canada,
  citm_catalog: citm,
  poet,
  github_events: github,
  "gsoc-2018": gsoc,
  lottie,
  otfcc: kinds,
  fgo: kinds,
};

export const twitterQueries = { find_tweet: findTweet, top_tweet: topTweet, distinct_user_id: distinctUserId };
