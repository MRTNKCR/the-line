# Data collection notes (v1)

## Goal

Start with a structured dataset that supports guided cooking:

- home-list browsing
- rich recipe detail pages
- timed, step-by-step execution
- portion scaling in metric units

## Dish scope

This MVP includes **50 globally popular dishes** in a TasteAtlas-focused ranking list format (`rank: 1..50`), represented in `data/recipes.js`.

## Sources

For each dish, the dataset stores a **Serious Eats recipe URL** and scraped
timing metadata.

Pipeline script:

- `scripts/scrape-serious-eats.mjs`

Outputs:

- `data/serious-eats-scraped.json` (full scrape log)
- `data/serious-eats-overrides.js` (runtime timing/source overrides)
- `data/serious-eats-content.js` (scraped source ingredient + instruction text)

The scraper reads recipe schema data (`application/ld+json`) and extracts:

- `prepTime`
- `cookTime`
- `totalTime` (including min/max duration objects when present)

Then it derives:

- `rest = total - prep - cook`

Instruction pipeline:

- extracts `recipeInstructions` and `recipeIngredient`
- expands long source instructions into app-readable sub-steps
- inserts an ingredient staging step that explicitly names all app ingredients
- retimes all steps so per-phase totals match scraped prep/rest/cook metadata

## Enrichment added in MVP

Each recipe includes:

- concise summary and historical context
- prep / rest / cook split scraped from Serious Eats where available
- complete ingredient list in metric units
- chronological steps with explicit durations (retimed to scraped split)
- planning steps such as:
  - pre-heat oven
  - start boiling water/stock
  - resting windows before finishing

## Matching quality

- `matchType: "exact"` means a direct dish page was found.
- `matchType: "search"` means the best search-based recipe match was used.
- `matchType: "proxy"` means Serious Eats has no direct dish page; closest
  available recipe is used and annotated with a note.

## Important MVP limitation

This is a **seed dataset** optimized for app-flow development and UX testing.

To move to production, add a data pipeline that:

1. Fetches and normalizes recipe content from licensed/public sources
2. Verifies dish ordering against a timestamped TasteAtlas snapshot
3. Human-reviews ingredient quantities and step durations
4. Stores provenance (source URL + fetch date + editor notes)
5. Adds nutrition, allergens, substitutions, and regional variants

## Why this shape works for future mobile apps

The schema is app-agnostic and can be reused by iOS/Android clients:

- stable recipe IDs
- portable timing model (`durationSec` per step)
- deterministic scaling model (metric quantities + base portions)
- explicit timeline phases (`prep`, `rest`, `cook`)

