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

For each dish, the dataset stores an internet source pointer:

- **Serious Eats search URL** (e.g., `https://www.seriouseats.com/search?q=<dish>`)

This provides a consistent starting point for validating and refining each recipe against editorial sources.

## Enrichment added in MVP

Each recipe includes:

- concise summary and historical context
- prep / rest / cook time split
- complete ingredient list in metric units
- chronological steps with explicit durations
- planning steps such as:
  - pre-heat oven
  - start boiling water/stock
  - resting windows before finishing

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

