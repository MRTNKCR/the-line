import { RECIPES } from "../data/recipes.js";

const errors = [];
const allowedUnits = new Set(["g", "kg", "ml", "l"]);

if (RECIPES.length !== 50) {
  errors.push(`Expected 50 recipes but found ${RECIPES.length}.`);
}

for (const recipe of RECIPES) {
  if (!recipe.id || !recipe.name || !recipe.origin) {
    errors.push(`Recipe missing identity fields: ${JSON.stringify(recipe.id)}`);
  }

  if (!recipe.summary || !recipe.history || !recipe.sourceUrl) {
    errors.push(`Recipe ${recipe.id} is missing summary/history/source.`);
  }

  if (!recipe.imageUrl || !recipe.imageThumbUrl) {
    errors.push(`Recipe ${recipe.id} is missing image URLs.`);
  }

  if (!recipe.timings || typeof recipe.timings !== "object") {
    errors.push(`Recipe ${recipe.id} has no timing split.`);
  } else {
    for (const key of ["prep", "rest", "cook"]) {
      if (typeof recipe.timings[key] !== "number" || recipe.timings[key] < 0) {
        errors.push(`Recipe ${recipe.id} has invalid ${key} timing.`);
      }
    }
    const timingTotal = recipe.timings.prep + recipe.timings.rest + recipe.timings.cook;
    if (timingTotal !== recipe.totalTimeMin) {
      errors.push(
        `Recipe ${recipe.id} totalTimeMin (${recipe.totalTimeMin}) does not match timing split (${timingTotal}).`
      );
    }
  }

  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    errors.push(`Recipe ${recipe.id} has no ingredients.`);
  } else {
    for (const ingredient of recipe.ingredients) {
      if (!ingredient.name || typeof ingredient.amount !== "number") {
        errors.push(`Recipe ${recipe.id} has malformed ingredient.`);
        continue;
      }
      if (!allowedUnits.has(ingredient.unit)) {
        errors.push(
          `Recipe ${recipe.id} ingredient "${ingredient.name}" uses non-metric unit "${ingredient.unit}".`
        );
      }
    }
  }

  if (!Array.isArray(recipe.steps) || recipe.steps.length < 6) {
    errors.push(`Recipe ${recipe.id} must contain at least 6 timed steps.`);
  } else {
    let computedTotal = 0;
    for (const step of recipe.steps) {
      if (!step.title || !step.detail || !step.phase) {
        errors.push(`Recipe ${recipe.id} has malformed step fields.`);
      }
      if (!step.imageUrl || !step.imageThumbUrl) {
        errors.push(`Recipe ${recipe.id} has malformed step image fields.`);
      }
      if (typeof step.durationSec !== "number" || step.durationSec < 0) {
        errors.push(`Recipe ${recipe.id} has invalid step duration.`);
      } else {
        computedTotal += Math.round(step.durationSec / 60);
      }
    }

    if (recipe.totalTimeMin !== computedTotal) {
      errors.push(
        `Recipe ${recipe.id} totalTimeMin (${recipe.totalTimeMin}) does not match step sum (${computedTotal}).`
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Data validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Data validation passed.");
console.log(`Recipes: ${RECIPES.length}`);
