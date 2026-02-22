import fs from "node:fs/promises";
import { SERIOUS_EATS_OVERRIDES } from "../data/serious-eats-overrides.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const getTypeSet = (rawType) => {
  if (Array.isArray(rawType)) {
    return new Set(rawType.map((value) => String(value).toLowerCase()));
  }
  return new Set([String(rawType ?? "").toLowerCase()]);
};

const extractJsonLdBlocks = (html) => {
  const blocks = [];
  const marker = 'type="application/ld+json"';
  let cursor = 0;
  while (true) {
    const markerIndex = html.indexOf(marker, cursor);
    if (markerIndex < 0) {
      break;
    }
    const contentStart = html.indexOf(">", markerIndex);
    const closeIndex = html.indexOf("</script>", contentStart + 1);
    if (contentStart < 0 || closeIndex < 0) {
      break;
    }
    blocks.push(html.slice(contentStart + 1, closeIndex).trim());
    cursor = closeIndex + "</script>".length;
  }
  return blocks;
};

const normalizeUrl = (rawUrl, base = "https://www.seriouseats.com") => {
  if (!rawUrl) {
    return null;
  }
  try {
    const parsed = new URL(decodeHtml(rawUrl), base);
    if (!parsed.protocol.startsWith("http")) {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
};

const shouldRejectImageUrl = (url) => {
  const text = url.toLowerCase();
  if (!text.includes("seriouseats")) {
    return true;
  }
  if (
    text.includes("schema_logo") ||
    text.includes("social_default") ||
    text.includes("logo")
  ) {
    return true;
  }
  if (text.endsWith(".gif")) {
    return true;
  }
  return false;
};

const scoreImageUrl = (url) => {
  const text = url.toLowerCase();
  let score = 0;
  if (text.endsWith(".jpg") || text.endsWith(".jpeg")) {
    score += 12;
  } else if (text.endsWith(".png") || text.endsWith(".webp")) {
    score += 8;
  } else if (text.endsWith(".gif")) {
    score -= 25;
  }

  if (text.includes("/1500x0/") || text.includes("/2000x0/")) {
    score += 6;
  }
  if (text.includes("hero")) {
    score += 3;
  }
  return score;
};

const pickBestImageUrl = (candidates) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const sorted = [...candidates].sort(
    (a, b) => scoreImageUrl(b) - scoreImageUrl(a)
  );
  return sorted[0] ?? null;
};

const collectImageUrls = (value, output) => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    const url = normalizeUrl(value);
    if (url && !shouldRejectImageUrl(url)) {
      output.push(url);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, output);
    }
    return;
  }
  if (typeof value === "object") {
    collectImageUrls(value.url, output);
    collectImageUrls(value.contentUrl, output);
    collectImageUrls(value["@id"], output);
  }
};

const dedupe = (values) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
};

const extractRecipeImageCandidates = (html) => {
  const candidates = [];
  for (const block of extractJsonLdBlocks(html)) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const typeSet = getTypeSet(entry["@type"]);
      if (!typeSet.has("recipe")) {
        continue;
      }
      collectImageUrls(entry.image, candidates);
    }
  }
  return dedupe(candidates);
};

const extractMetaImageCandidate = (html) => {
  const patterns = [
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match) {
      continue;
    }
    const url = normalizeUrl(match[1]);
    if (url && !shouldRejectImageUrl(url)) {
      return url;
    }
  }
  return null;
};

const toThumb = (imageUrl) => {
  if (!imageUrl) {
    return null;
  }
  if (imageUrl.includes("/1500x0/")) {
    return imageUrl.replace("/1500x0/", "/480x320/");
  }
  if (imageUrl.includes("/2000x0/")) {
    return imageUrl.replace("/2000x0/", "/480x320/");
  }
  if (imageUrl.includes("/1600x0/")) {
    return imageUrl.replace("/1600x0/", "/480x320/");
  }
  return imageUrl;
};

const fetchHtml = async (url) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
};

const run = async () => {
  const map = {};
  const missing = [];

  for (const [recipeId, meta] of Object.entries(SERIOUS_EATS_OVERRIDES)) {
    try {
      const html = await fetchHtml(meta.sourceUrl);
      const recipeCandidates = extractRecipeImageCandidates(html);
      const fallbackMetaImage = extractMetaImageCandidate(html);
      const imageUrl = pickBestImageUrl(recipeCandidates) ?? fallbackMetaImage;

      if (!imageUrl) {
        missing.push(recipeId);
        console.log(`MISS ${recipeId}`);
        continue;
      }

      map[recipeId] = {
        imageUrl,
        imageThumbUrl: toThumb(imageUrl),
        sourceUrl: meta.sourceUrl,
      };

      console.log(`OK   ${recipeId}`);
    } catch (error) {
      missing.push(recipeId);
      console.log(`MISS ${recipeId} (${error.message})`);
    }

    await wait(90);
  }

  const moduleText = `export const SERIOUS_EATS_IMAGES = ${JSON.stringify(
    map,
    null,
    2
  )};\n`;
  await fs.writeFile(
    new URL("../data/serious-eats-images.js", import.meta.url),
    moduleText,
    "utf8"
  );

  await fs.writeFile(
    new URL("../data/serious-eats-images.json", import.meta.url),
    `${JSON.stringify(map, null, 2)}\n`,
    "utf8"
  );

  console.log(`\nDone. images: ${Object.keys(map).length}`);
  console.log(`Missing: ${missing.length}`);
  if (missing.length) {
    console.log(missing.join(", "));
  }
};

await run();
