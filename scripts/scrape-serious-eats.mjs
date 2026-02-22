import fs from "node:fs/promises";
import { RECIPES } from "../data/recipes.js";

const SEARCH_URL = "https://www.seriouseats.com/search?q=";
const MIN_CONFIDENCE = 2;

const URL_OVERRIDES = {
  "peking-duck": {
    url: "https://www.seriouseats.com/peking-duck-mandarin-pancakes-plum-sauce-recipe",
    matchType: "exact",
  },
  "paella-valenciana": {
    url: "https://www.seriouseats.com/grilled-paella-mixta-mixed-paella-with-chicken-and-seafood",
    matchType: "proxy",
    note: "No direct paella Valenciana page found on Serious Eats; closest paella recipe used.",
  },
  "moussaka": {
    url: "https://www.seriouseats.com/moussaka-6361068",
    matchType: "exact",
  },
  "tom-yum-goong": {
    url: "https://www.seriouseats.com/creamy-tom-yam-kung-thai-hot-and-sour-soup-recipe",
    matchType: "exact",
  },
  "pho-bo": {
    url: "https://www.seriouseats.com/traditional-beef-pho-recipe",
    matchType: "exact",
  },
  "doner-kebab": {
    url: "https://www.seriouseats.com/adana-kebab-turkish-ground-lamb-kebab-recipe",
    matchType: "proxy",
    note: "No direct doner kebab page found on Serious Eats; closest Turkish kebab recipe used.",
  },
  "pierogi": {
    url: "https://www.seriouseats.com/pierogi-recipe-5220146",
    matchType: "exact",
  },
  "katsu-curry": {
    url: "https://www.seriouseats.com/japanese-curry-kare",
    matchType: "proxy",
    note: "No direct katsu curry page found on Serious Eats; Japanese curry recipe used.",
  },
  "kimchi-jjigae": {
    url: "https://www.seriouseats.com/momofuku-david-chang-kimchi-stew-with-rice-cakes-recipe",
    matchType: "exact",
  },
  "hummus-and-pita": {
    url: "https://www.seriouseats.com/hummus-msabbaha-masabacha-musabbaha-chickpea-recipe",
    matchType: "exact",
  },
  "gnocchi-al-pesto": {
    url: "https://www.seriouseats.com/ricotta-gnocchi-homemade-food-lab-recipe",
    matchType: "proxy",
    note: "No direct gnocchi al pesto page found on Serious Eats; gnocchi base recipe used.",
  },
  "beef-bourguignon": {
    url: "https://www.seriouseats.com/beef-bourguignon-red-wine-stew-recipe",
    matchType: "exact",
  },
  "baklava": {
    url: "https://www.seriouseats.com/homemade-pistachio-baklava-recipe-8742422",
    matchType: "exact",
  },
  "tiramisu": {
    url: "https://www.seriouseats.com/best-tiramisu-recipe",
    matchType: "exact",
  },
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "alla",
  "al",
  "la",
  "de",
  "di",
  "au",
  "style",
  "recipe",
]);

const PAGE_CACHE = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"');

const normalizeText = (text) =>
  decodeHtml(text)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const toTokens = (text) =>
  normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));

const parseIsoDurationToMin = (value) => {
  if (typeof value !== "string" || !value.startsWith("P")) {
    return null;
  }
  const match =
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value);
  if (!match) {
    return null;
  }
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const mins = Number.parseInt(match[3] ?? "0", 10);
  const secs = Number.parseInt(match[4] ?? "0", 10);
  return days * 1440 + hours * 60 + mins + Math.round(secs / 60);
};

const parseDurationField = (field) => {
  if (typeof field === "string") {
    return parseIsoDurationToMin(field);
  }
  if (field && typeof field === "object") {
    const candidates = [
      field.minValue,
      field.value,
      field.maxValue,
      field["@value"],
    ];
    for (const candidate of candidates) {
      const parsed = parseIsoDurationToMin(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
};

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

const extractRecipeFromHtml = (html) => {
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

      const prepMin = parseDurationField(entry.prepTime) ?? 0;
      const cookMin = parseDurationField(entry.cookTime) ?? 0;
      const totalMinCandidate = parseDurationField(entry.totalTime);
      const totalMin =
        totalMinCandidate ?? Math.max(0, Math.round(prepMin + cookMin));
      const restMin = Math.max(0, totalMin - prepMin - cookMin);

      return {
        title: decodeHtml(entry.name ?? entry.headline ?? ""),
        description: decodeHtml(entry.description ?? ""),
        yield: entry.recipeYield ?? null,
        prepMin,
        cookMin,
        restMin,
        totalMin,
      };
    }
  }
  return null;
};

const cleanUrl = (rawUrl) => {
  try {
    const decoded = rawUrl
      .replaceAll("&amp;", "&")
      .replace(/['")\]}>,.]+$/, "");
    const parsed = new URL(decoded);
    if (parsed.hostname !== "www.seriouseats.com") {
      return null;
    }
    if (parsed.pathname.startsWith("/thmb/")) {
      return null;
    }
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.toLowerCase();
    if (
      pathname.endsWith(".jpg") ||
      pathname.endsWith(".jpeg") ||
      pathname.endsWith(".png") ||
      pathname.endsWith(".webp") ||
      pathname.endsWith(".svg")
    ) {
      return null;
    }
    if (parsed.pathname === "/" || parsed.pathname.startsWith("/search")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const extractCandidateUrls = (html) => {
  const urls = new Set();
  const absRegex = /https:\/\/www\.seriouseats\.com\/[^"'<>\s]+/g;
  for (const match of html.matchAll(absRegex)) {
    const cleaned = cleanUrl(match[0]);
    if (cleaned) {
      urls.add(cleaned);
    }
  }
  const relRegex = /href="(\/[^"]+)"/g;
  for (const match of html.matchAll(relRegex)) {
    const cleaned = cleanUrl(`https://www.seriouseats.com${match[1]}`);
    if (cleaned) {
      urls.add(cleaned);
    }
  }
  return Array.from(urls);
};

const scoreUrl = (recipeName, url) => {
  const queryTokens = toTokens(recipeName);
  const urlTokens = toTokens(url);
  const urlTokenSet = new Set(urlTokens);

  let score = 0;
  for (const token of queryTokens) {
    if (urlTokenSet.has(token)) {
      score += 5;
    }
  }

  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes("recipe")) {
    score += 10;
  }
  if (
    lowerUrl.includes("slideshow") ||
    lowerUrl.includes("guides") ||
    lowerUrl.includes("where-to-eat")
  ) {
    score -= 12;
  }
  if (
    lowerUrl.includes("cookie") ||
    lowerUrl.includes("pot-pie") ||
    lowerUrl.includes("sandwich")
  ) {
    score -= 8;
  }

  return score;
};

const similarityScore = (dishName, recipeTitle, url) => {
  const dishTokens = toTokens(dishName);
  const titleTokens = new Set(toTokens(recipeTitle));
  const urlTokens = new Set(toTokens(url));
  let overlap = 0;

  for (const token of dishTokens) {
    if (titleTokens.has(token) || urlTokens.has(token)) {
      overlap += 1;
    }
  }

  const dishNorm = normalizeText(dishName);
  const titleNorm = normalizeText(recipeTitle);
  if (titleNorm.includes(dishNorm) || dishNorm.includes(titleNorm)) {
    overlap += 3;
  }

  return overlap;
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

const getRecipePageInfo = async (url) => {
  if (PAGE_CACHE.has(url)) {
    return PAGE_CACHE.get(url);
  }
  let info = null;
  try {
    const html = await fetchHtml(url);
    const recipe = extractRecipeFromHtml(html);
    if (recipe) {
      info = { url, ...recipe };
    }
  } catch {
    info = null;
  }
  PAGE_CACHE.set(url, info);
  return info;
};

const findBestSeriousEatsRecipe = async (recipe) => {
  const override = URL_OVERRIDES[recipe.id];
  if (override) {
    const pageInfo = await getRecipePageInfo(override.url);
    if (!pageInfo) {
      return {
        searchUrl: null,
        candidateCount: 1,
        best: null,
        matchType: override.matchType,
        note: override.note ?? null,
      };
    }
    return {
      searchUrl: null,
      candidateCount: 1,
      best: {
        ...pageInfo,
        confidence: similarityScore(recipe.name, pageInfo.title ?? "", pageInfo.url),
      },
      matchType: override.matchType,
      note: override.note ?? null,
    };
  }

  const searchUrl = `${SEARCH_URL}${encodeURIComponent(recipe.name)}`;
  const html = await fetchHtml(searchUrl);
  const candidates = extractCandidateUrls(html)
    .map((url) => ({ url, score: scoreUrl(recipe.name, url) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);

  let best = null;
  for (const candidate of candidates) {
    const pageInfo = await getRecipePageInfo(candidate.url);
    await wait(100);
    if (!pageInfo) {
      continue;
    }
    const confidence = similarityScore(recipe.name, pageInfo.title ?? "", candidate.url);
    if (!best || confidence > best.confidence) {
      best = { ...pageInfo, confidence };
    }
  }

  if (best && best.confidence < MIN_CONFIDENCE) {
    best = null;
  }

  return {
    searchUrl,
    candidateCount: candidates.length,
    best,
    matchType: "search",
    note: null,
  };
};

const run = async () => {
  const output = [];
  const missing = [];
  const overrideModuleMap = {};

  for (const recipe of RECIPES) {
    const result = await findBestSeriousEatsRecipe(recipe);
    if (!result.best) {
      missing.push(recipe.id);
      output.push({
        id: recipe.id,
        name: recipe.name,
        found: false,
        searchUrl: result.searchUrl,
        candidateCount: result.candidateCount,
        matchType: result.matchType,
        note: result.note,
      });
      console.log(`MISS  ${recipe.name}`);
      continue;
    }

    const scraped = {
      id: recipe.id,
      name: recipe.name,
      found: true,
      sourceUrl: result.best.url,
      sourceLabel:
        result.matchType === "proxy"
          ? "Serious Eats (closest available dish)"
          : "Serious Eats",
      matchedTitle: result.best.title,
      recipeYield: result.best.yield,
      timings: {
        prep: result.best.prepMin,
        rest: result.best.restMin,
        cook: result.best.cookMin,
      },
      totalTimeMin: result.best.totalMin,
      confidence: result.best.confidence,
      matchType: result.matchType,
      note: result.note,
    };

    output.push(scraped);
    overrideModuleMap[recipe.id] = {
      sourceUrl: scraped.sourceUrl,
      sourceLabel: scraped.sourceLabel,
      matchedTitle: scraped.matchedTitle,
      recipeYield: scraped.recipeYield,
      timings: scraped.timings,
      totalTimeMin: scraped.totalTimeMin,
      confidence: scraped.confidence,
      matchType: scraped.matchType,
      note: scraped.note,
    };

    console.log(
      `MATCH ${recipe.name} -> ${result.best.title} [${result.best.prepMin}/${result.best.restMin}/${result.best.cookMin}] (${result.matchType})`
    );
  }

  await fs.writeFile(
    new URL("../data/serious-eats-scraped.json", import.meta.url),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );

  const moduleContents = `export const SERIOUS_EATS_OVERRIDES = ${JSON.stringify(
    overrideModuleMap,
    null,
    2
  )};\n`;

  await fs.writeFile(
    new URL("../data/serious-eats-overrides.js", import.meta.url),
    moduleContents,
    "utf8"
  );

  console.log(`\nDone. Wrote ${output.length} records.`);
  console.log(`Missing matches: ${missing.length}`);
  if (missing.length > 0) {
    console.log(`Missing IDs: ${missing.join(", ")}`);
  }
};

await run();
