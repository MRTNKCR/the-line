import fs from "node:fs/promises";
import { SERIOUS_EATS_OVERRIDES } from "../data/serious-eats-overrides.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

const stripHtml = (value) =>
  decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

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

const flattenInstructions = (value, output) => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    const cleaned = stripHtml(value);
    if (cleaned) {
      output.push(cleaned);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenInstructions(item, output);
    }
    return;
  }
  if (typeof value === "object") {
    const typeSet = getTypeSet(value["@type"]);
    if (typeSet.has("howtosection")) {
      flattenInstructions(value.itemListElement, output);
      return;
    }
    if (typeSet.has("howtostep")) {
      const text = stripHtml(value.text ?? value.name ?? "");
      if (text) {
        output.push(text);
      }
      return;
    }
    if (value.text || value.name) {
      const text = stripHtml(value.text ?? value.name ?? "");
      if (text) {
        output.push(text);
      }
      return;
    }
  }
};

const uniq = (values) => {
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

const extractRecipeContent = (html) => {
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

      const sourceIngredients = uniq(
        (Array.isArray(entry.recipeIngredient) ? entry.recipeIngredient : [])
          .map((raw) => stripHtml(raw))
          .filter(Boolean)
      );

      const sourceInstructions = [];
      flattenInstructions(entry.recipeInstructions, sourceInstructions);

      return {
        sourceTitle: stripHtml(entry.name ?? entry.headline ?? ""),
        sourceDescription: stripHtml(entry.description ?? ""),
        sourceIngredients,
        sourceInstructions: uniq(sourceInstructions),
      };
    }
  }
  return null;
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
  const misses = [];

  for (const [recipeId, meta] of Object.entries(SERIOUS_EATS_OVERRIDES)) {
    try {
      const html = await fetchHtml(meta.sourceUrl);
      const content = extractRecipeContent(html);
      if (!content || content.sourceInstructions.length === 0) {
        misses.push(recipeId);
        console.log(`MISS ${recipeId}`);
        continue;
      }

      map[recipeId] = content;
      console.log(
        `OK   ${recipeId} -> ${content.sourceInstructions.length} instructions`
      );
    } catch (error) {
      misses.push(recipeId);
      console.log(`MISS ${recipeId} (${error.message})`);
    }
    await wait(110);
  }

  await fs.writeFile(
    new URL("../data/serious-eats-content.js", import.meta.url),
    `export const SERIOUS_EATS_CONTENT = ${JSON.stringify(map, null, 2)};\n`,
    "utf8"
  );

  console.log(`\nDone. recipes: ${Object.keys(map).length}`);
  console.log(`Missing: ${misses.length}`);
  if (misses.length > 0) {
    console.log(misses.join(", "));
  }
};

await run();
