import fs from "node:fs/promises";
import { SERIOUS_EATS_OVERRIDES } from "../data/serious-eats-overrides.js";
import { SERIOUS_EATS_IMAGES } from "../data/serious-eats-images.js";

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
    text.includes("/logo") ||
    text.includes("icon") ||
    text.includes("avatar")
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
  }
  if (text.includes("/1500x0/") || text.includes("/2000x0/")) {
    score += 6;
  }
  if (text.includes("step")) {
    score += 4;
  }
  if (text.includes("hero")) {
    score += 2;
  }
  return score;
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
    collectImageUrls(value.thumbnailUrl, output);
    collectImageUrls(value.image, output);
    collectImageUrls(value["@id"], output);
  }
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

const flattenJsonLdEntries = (parsed) => {
  const out = [];
  const visit = (value) => {
    if (!value) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    out.push(value);
    if (Array.isArray(value["@graph"])) {
      visit(value["@graph"]);
    }
    if (Array.isArray(value.graph)) {
      visit(value.graph);
    }
  };
  visit(parsed);
  return out;
};

const extractStepImagesFromInstructions = (value, output) => {
  if (!value) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractStepImagesFromInstructions(item, output);
    }
    return;
  }
  if (typeof value === "object") {
    const typeSet = getTypeSet(value["@type"]);
    if (typeSet.has("howtosection")) {
      extractStepImagesFromInstructions(value.itemListElement, output);
      return;
    }
    if (typeSet.has("howtostep")) {
      const candidates = [];
      collectImageUrls(value.image, candidates);
      collectImageUrls(value.thumbnailUrl, candidates);
      collectImageUrls(value.associatedMedia, candidates);
      collectImageUrls(value.video, candidates);
      const best = pickBestImageUrl(dedupe(candidates));
      if (best) {
        output.push(best);
      }
      return;
    }
    if (Array.isArray(value.itemListElement)) {
      extractStepImagesFromInstructions(value.itemListElement, output);
      return;
    }
    const fallbackCandidates = [];
    collectImageUrls(value.image, fallbackCandidates);
    collectImageUrls(value.thumbnailUrl, fallbackCandidates);
    const text = stripHtml(value.text ?? value.name ?? "");
    if (text) {
      const best = pickBestImageUrl(dedupe(fallbackCandidates));
      if (best) {
        output.push(best);
      }
    }
  }
};

const extractRecipeStepImageCandidates = (html) => {
  for (const block of extractJsonLdBlocks(html)) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const entries = flattenJsonLdEntries(parsed);
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const typeSet = getTypeSet(entry["@type"]);
      if (!typeSet.has("recipe")) {
        continue;
      }
      const stepImageUrls = [];
      extractStepImagesFromInstructions(entry.recipeInstructions, stepImageUrls);
      const cleaned = dedupe(stepImageUrls);
      if (cleaned.length > 0) {
        return cleaned;
      }
    }
  }
  return [];
};

const extractInlineImageCandidates = (html) => {
  const out = [];
  const imgTagPattern = /<img\b[^>]*>/gi;
  const attrPattern = /\b(src|data-src|data-hi-res-src)=["']([^"']+)["']/gi;
  const srcSetPattern = /\b(srcset|data-srcset)=["']([^"']+)["']/gi;

  let tagMatch = imgTagPattern.exec(html);
  while (tagMatch) {
    const tag = tagMatch[0];
    let attrMatch = attrPattern.exec(tag);
    while (attrMatch) {
      const normalized = normalizeUrl(attrMatch[2]);
      if (normalized && !shouldRejectImageUrl(normalized)) {
        out.push(normalized);
      }
      attrMatch = attrPattern.exec(tag);
    }

    let srcSetMatch = srcSetPattern.exec(tag);
    while (srcSetMatch) {
      const candidates = String(srcSetMatch[2])
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const candidate of candidates) {
        const normalized = normalizeUrl(candidate);
        if (normalized && !shouldRejectImageUrl(normalized)) {
          out.push(normalized);
        }
      }
      srcSetMatch = srcSetPattern.exec(tag);
    }
    tagMatch = imgTagPattern.exec(html);
  }

  const deduped = dedupe(out);
  const withQuality = deduped.filter((url) => scoreImageUrl(url) >= 0);
  return withQuality.length > 0 ? withQuality : deduped;
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
    return imageUrl.replace("/1500x0/", "/640x360/");
  }
  if (imageUrl.includes("/2000x0/")) {
    return imageUrl.replace("/2000x0/", "/640x360/");
  }
  if (imageUrl.includes("/1600x0/")) {
    return imageUrl.replace("/1600x0/", "/640x360/");
  }
  return imageUrl;
};

const toHeroFallback = (recipeId, sourceUrl) => {
  const heroImage = SERIOUS_EATS_IMAGES[recipeId];
  if (!heroImage?.imageUrl) {
    return null;
  }
  return {
    sourceUrl: sourceUrl ?? heroImage.sourceUrl ?? null,
    source: "recipe-hero-fallback",
    stepImageUrls: [heroImage.imageUrl],
    stepImageThumbUrls: [heroImage.imageThumbUrl ?? toThumb(heroImage.imageUrl)],
  };
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
      const jsonLdStepImages = extractRecipeStepImageCandidates(html);

      let stepImageUrls = jsonLdStepImages;
      let source = "jsonld-step-images";
      if (stepImageUrls.length === 0) {
        stepImageUrls = extractInlineImageCandidates(html).slice(0, 24);
        source = "html-inline-images";
      }
      if (stepImageUrls.length === 0) {
        const metaImage = extractMetaImageCandidate(html);
        stepImageUrls = metaImage ? [metaImage] : [];
        source = "meta-fallback";
      }

      if (stepImageUrls.length === 0) {
        const fallback = toHeroFallback(recipeId, meta.sourceUrl);
        if (fallback) {
          map[recipeId] = fallback;
          console.log(`FALLBACK ${recipeId} -> 1 hero image`);
          await wait(90);
          continue;
        }
        misses.push(recipeId);
        console.log(`MISS ${recipeId}`);
        await wait(90);
        continue;
      }

      map[recipeId] = {
        sourceUrl: meta.sourceUrl,
        source,
        stepImageUrls,
        stepImageThumbUrls: stepImageUrls.map((url) => toThumb(url)),
      };

      console.log(`OK   ${recipeId} -> ${stepImageUrls.length} step images`);
    } catch (error) {
      const fallback = toHeroFallback(recipeId, meta.sourceUrl);
      if (fallback) {
        map[recipeId] = fallback;
        console.log(`FALLBACK ${recipeId} -> 1 hero image (${error.message})`);
      } else {
        misses.push(recipeId);
        console.log(`MISS ${recipeId} (${error.message})`);
      }
    }

    await wait(90);
  }

  await fs.writeFile(
    new URL("../data/serious-eats-step-images.js", import.meta.url),
    `export const SERIOUS_EATS_STEP_IMAGES = ${JSON.stringify(map, null, 2)};\n`,
    "utf8"
  );

  await fs.writeFile(
    new URL("../data/serious-eats-step-images.json", import.meta.url),
    `${JSON.stringify(map, null, 2)}\n`,
    "utf8"
  );

  console.log(`\nDone. recipes: ${Object.keys(map).length}`);
  console.log(`Missing: ${misses.length}`);
  if (misses.length > 0) {
    console.log(misses.join(", "));
  }
};

await run();
