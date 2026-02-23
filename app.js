import { RECIPES } from "./data/recipes.js";

const app = document.querySelector("#app");
const recipeById = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="100%" height="100%" fill="white"/><rect x="24" y="24" width="912" height="592" fill="none" stroke="black" stroke-width="8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="black" font-size="42" font-family="Arial">Dish photo</text></svg>'
  );

const MOBILE_FILTER_BREAKPOINT = 900;
const isMobileViewport = () =>
  typeof window !== "undefined" &&
  window.matchMedia(`(max-width: ${MOBILE_FILTER_BREAKPOINT}px)`).matches;

const state = {
  screen: "home", // home | detail | cook-cards
  selectedRecipeId: null,
  cookSession: null,
  filtersPanelOpen: !isMobileViewport(),
  filters: {
    cuisine: "all",
    timeBucket: "all",
    ingredientIds: [],
    ingredientQuery: "",
  },
};

const CUISINE_OPTIONS = Array.from(new Set(RECIPES.map((recipe) => recipe.origin)))
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, "en"));

const TIME_BUCKET_OPTIONS = [
  { id: "all", label: "Any cooking time" },
  { id: "0-1", label: "0-1 hour" },
  { id: "1-2", label: "1-2 hours" },
  { id: "2-3", label: "2-3 hours" },
  { id: "3+", label: "More than 3 hours" },
];

const normalizeWord = (value) => {
  const cleaned = String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (cleaned.length <= 2) {
    return cleaned;
  }
  if (cleaned.endsWith("ies") && cleaned.length > 4) {
    return `${cleaned.slice(0, -3)}y`;
  }
  if (cleaned.endsWith("oes") && cleaned.length > 4) {
    return cleaned.slice(0, -2);
  }
  if (cleaned.endsWith("os") && cleaned.length > 4) {
    return cleaned.slice(0, -1);
  }
  if (cleaned.endsWith("es") && cleaned.length > 4) {
    return cleaned.slice(0, -2);
  }
  if (cleaned.endsWith("s") && cleaned.length > 3) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
};

const toIngredientTokens = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);

const normalizeIngredientKey = (value) => toIngredientTokens(value).join(" ");

const ingredientOptionMap = new Map();
for (const recipe of RECIPES) {
  for (const ingredient of recipe.ingredients) {
    const key = normalizeIngredientKey(ingredient.name);
    if (!key) {
      continue;
    }
    if (!ingredientOptionMap.has(key)) {
      ingredientOptionMap.set(key, {
        id: key,
        label: ingredient.name,
        tokens: toIngredientTokens(ingredient.name),
      });
    }
  }
}

const INGREDIENT_OPTIONS = Array.from(ingredientOptionMap.values()).sort((a, b) =>
  a.label.localeCompare(b.label, "en")
);
const INGREDIENT_OPTION_ID_SET = new Set(INGREDIENT_OPTIONS.map((opt) => opt.id));

const recipeIngredientTokenMap = new Map(
  RECIPES.map((recipe) => [
    recipe.id,
    new Set(
      recipe.ingredients.flatMap((ingredient) => toIngredientTokens(ingredient.name))
    ),
  ])
);

const TIME_BUCKET_ID_SET = new Set(TIME_BUCKET_OPTIONS.map((bucket) => bucket.id));
const CUISINE_OPTION_SET = new Set(CUISINE_OPTIONS);

let ticker = null;
let lastRenderedActiveStep = -1;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatNumber = (value) => {
  if (Number.isInteger(value)) {
    return String(value);
  }
  if (value >= 100) {
    return value.toFixed(0);
  }
  if (value >= 10) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  return value.toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
};

const formatAmount = (amount, unit) => {
  if (unit === "g" && amount >= 1000) {
    return `${formatNumber(amount / 1000)} kg`;
  }

  if (unit === "ml" && amount >= 1000) {
    return `${formatNumber(amount / 1000)} l`;
  }

  return `${formatNumber(amount)} ${unit}`;
};

const formatTimeLabel = (minutes) => {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} h`;
  }
  return `${hours} h ${mins} min`;
};

const formatClock = (seconds) => {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

const getSelectedRecipe = () => {
  if (!state.selectedRecipeId) {
    return null;
  }
  return recipeById.get(state.selectedRecipeId) ?? null;
};

const stopTicker = () => {
  if (!ticker) {
    return;
  }
  clearInterval(ticker);
  ticker = null;
};

const syncSessionToNonZeroStep = (session, recipe) => {
  if (!session || !recipe || recipe.steps.length === 0) {
    return;
  }

  while (
    !session.completed &&
    session.stepIndex < recipe.steps.length &&
    recipe.steps[session.stepIndex].durationSec === 0
  ) {
    if (session.stepIndex >= recipe.steps.length - 1) {
      session.remainingSec = 0;
      session.completed = true;
      session.paused = true;
      return;
    }
    session.stepIndex += 1;
  }

  if (!session.completed) {
    session.remainingSec = recipe.steps[session.stepIndex].durationSec;
  }
};

const ensureTicker = () => {
  if (ticker) {
    return;
  }
  ticker = setInterval(() => {
    const session = state.cookSession;
    if (!session || state.screen !== "cook-cards" || session.paused || session.completed) {
      return;
    }

    session.remainingSec = Math.max(0, session.remainingSec - 1);

    if (session.remainingSec === 0) {
      const recipe = recipeById.get(session.recipeId);
      if (!recipe) {
        return;
      }

      if (session.stepIndex < recipe.steps.length - 1) {
        session.stepIndex += 1;
        syncSessionToNonZeroStep(session, recipe);
      } else {
        session.completed = true;
        session.paused = true;
      }
    }

    render();
  }, 1000);
};

const beginCookSession = (recipe) => {
  state.cookSession = {
    recipeId: recipe.id,
    stepIndex: 0,
    remainingSec: recipe.steps[0].durationSec,
    paused: false,
    completed: false,
  };
  syncSessionToNonZeroStep(state.cookSession, recipe);
  state.screen = "cook-cards";
  ensureTicker();
  render();
};

const shiftStepManually = (delta) => {
  const session = state.cookSession;
  if (!session) {
    return;
  }

  const recipe = recipeById.get(session.recipeId);
  if (!recipe) {
    return;
  }

  const nextIndex = Math.min(
    recipe.steps.length - 1,
    Math.max(0, session.stepIndex + delta)
  );

  session.stepIndex = nextIndex;
  session.completed = false;
  syncSessionToNonZeroStep(session, recipe);
  render();
};

const getStepTimerProgressPercent = (session, recipe) => {
  if (!session || !recipe) {
    return 0;
  }
  const current = recipe.steps[session.stepIndex];
  if (!current || current.durationSec <= 0) {
    return 100;
  }
  const elapsed = current.durationSec - session.remainingSec;
  return Math.max(0, Math.min(100, Math.round((elapsed / current.durationSec) * 100)));
};

const matchesTimeBucket = (totalTimeMin, bucketId) => {
  switch (bucketId) {
    case "0-1":
      return totalTimeMin <= 60;
    case "1-2":
      return totalTimeMin > 60 && totalTimeMin <= 120;
    case "2-3":
      return totalTimeMin > 120 && totalTimeMin <= 180;
    case "3+":
      return totalTimeMin > 180;
    default:
      return true;
  }
};

const matchesSelectedIngredients = (recipeId, selectedIngredientIds) => {
  if (selectedIngredientIds.length === 0) {
    return true;
  }
  const recipeTokens = recipeIngredientTokenMap.get(recipeId);
  if (!recipeTokens) {
    return false;
  }
  return selectedIngredientIds.every((ingredientId) => {
    const requiredTokens = ingredientId.split(" ").filter(Boolean);
    return requiredTokens.every((token) => recipeTokens.has(token));
  });
};

const getFilteredIngredientOptions = () => {
  const queryTokens = toIngredientTokens(state.filters.ingredientQuery);
  const selectedIdSet = new Set(state.filters.ingredientIds);

  const matched = INGREDIENT_OPTIONS.filter((option) => {
    if (queryTokens.length === 0) {
      return true;
    }
    return queryTokens.every((queryToken) =>
      option.tokens.some(
        (token) => token.includes(queryToken) || queryToken.includes(token)
      )
    );
  });

  matched.sort((a, b) => {
    const aSelected = selectedIdSet.has(a.id) ? 1 : 0;
    const bSelected = selectedIdSet.has(b.id) ? 1 : 0;
    if (aSelected !== bSelected) {
      return bSelected - aSelected;
    }
    return a.label.localeCompare(b.label, "en");
  });

  return matched.slice(0, 40);
};

const getFilteredRecipes = () =>
  RECIPES.filter((recipe) => {
    const cuisinePass =
      state.filters.cuisine === "all" || recipe.origin === state.filters.cuisine;
    const timePass = matchesTimeBucket(recipe.totalTimeMin, state.filters.timeBucket);
    const ingredientPass = matchesSelectedIngredients(
      recipe.id,
      state.filters.ingredientIds
    );
    return cuisinePass && timePass && ingredientPass;
  });

const renderHome = () => {
  const filteredRecipes = getFilteredRecipes();
  const filteredIngredientOptions = getFilteredIngredientOptions();
  const selectedIngredients = state.filters.ingredientIds
    .map((id) => ingredientOptionMap.get(id))
    .filter(Boolean);
  const isMobile = isMobileViewport();
  const filtersCollapsed = isMobile && !state.filtersPanelOpen;
  const hasActiveFilters =
    state.filters.cuisine !== "all" ||
    state.filters.timeBucket !== "all" ||
    state.filters.ingredientIds.length > 0;

  return `
    <section class="home-screen">
      <header class="screen-header">
        <div>
          <h2 class="screen-title">Global dish list</h2>
          <p class="muted">${filteredRecipes.length} of ${RECIPES.length} recipes shown</p>
        </div>
      </header>

      <div class="home-layout">
        <aside class="home-sidebar">
          <section class="panel filter-panel">
            <div class="filter-panel-header">
              <h3>Filters</h3>
              ${
                isMobile
                  ? `
                    <button class="button filter-toggle" data-action="toggle-filters">
                      ${state.filtersPanelOpen ? "Hide filters" : "Show filters"}
                    </button>
                  `
                  : ""
              }
            </div>

            ${
              filtersCollapsed
                ? `
                  ${
                    hasActiveFilters
                      ? `
                        <div class="button-row">
                          <button class="button" data-action="clear-filters">
                            Clear filters
                          </button>
                        </div>
                      `
                      : ""
                  }
                `
                : ""
            }

            <div class="filters-body ${filtersCollapsed ? "is-collapsed" : ""}">
              <div class="filters-grid">
                <div class="filter-field">
                  <label for="cuisine-filter">Type of cuisine</label>
                  <select id="cuisine-filter" data-action="filter-cuisine">
                    <option value="all">All cuisines</option>
                    ${CUISINE_OPTIONS.map(
                      (cuisine) => `
                        <option
                          value="${escapeHtml(cuisine)}"
                          ${state.filters.cuisine === cuisine ? "selected" : ""}
                        >
                          ${escapeHtml(cuisine)}
                        </option>
                      `
                    ).join("")}
                  </select>
                </div>

                <div class="filter-field">
                  <label for="time-filter">Cooking time</label>
                  <select id="time-filter" data-action="filter-time">
                    ${TIME_BUCKET_OPTIONS.map(
                      (bucket) => `
                        <option
                          value="${bucket.id}"
                          ${state.filters.timeBucket === bucket.id ? "selected" : ""}
                        >
                          ${bucket.label}
                        </option>
                      `
                    ).join("")}
                  </select>
                </div>

                <div class="filter-field">
                  <label for="ingredient-filter-search">Ingredients (multi-select)</label>
                  <input
                    id="ingredient-filter-search"
                    class="ingredient-search-input"
                    type="search"
                    placeholder="Search ingredients (e.g. flour, basil, tomatoes)"
                    data-action="filter-ingredient-search"
                    value="${escapeHtml(state.filters.ingredientQuery)}"
                  />
                  ${
                    selectedIngredients.length > 0
                      ? `
                        <div class="ingredient-chip-wrap">
                          ${selectedIngredients
                            .map(
                              (option) => `
                                <button
                                  class="ingredient-chip"
                                  data-action="remove-ingredient"
                                  data-id="${escapeHtml(option.id)}"
                                >
                                  ${escapeHtml(option.label)} ×
                                </button>
                              `
                            )
                            .join("")}
                        </div>
                      `
                      : `<p class="muted">No ingredients selected yet.</p>`
                  }
                  <div class="ingredient-options" role="listbox" aria-label="Ingredient options">
                    ${
                      filteredIngredientOptions.length > 0
                        ? filteredIngredientOptions
                            .map(
                              (option) => `
                                <button
                                  class="ingredient-option ${
                                    state.filters.ingredientIds.includes(option.id)
                                      ? "selected"
                                      : ""
                                  }"
                                  data-action="toggle-ingredient"
                                  data-id="${escapeHtml(option.id)}"
                                  aria-pressed="${
                                    state.filters.ingredientIds.includes(option.id)
                                      ? "true"
                                      : "false"
                                  }"
                                >
                                  ${escapeHtml(option.label)}
                                </button>
                              `
                            )
                            .join("")
                        : `<p class="muted">No ingredient options match your search.</p>`
                    }
                  </div>
                </div>
              </div>

              <div class="button-row">
                <button
                  class="button"
                  data-action="clear-filters"
                  ${hasActiveFilters ? "" : "disabled"}
                >
                  Clear filters
                </button>
              </div>
            </div>
          </section>
        </aside>

        <div class="home-content">
          ${
            filteredRecipes.length === 0
              ? `
                <section class="panel">
                  <p>No recipes match the selected filters.</p>
                </section>
              `
              : `
                <ul class="recipe-list">
                  ${filteredRecipes
                    .map(
                      (recipe) => `
                        <li class="recipe-card">
                          <button
                            class="recipe-card-button"
                            data-action="open-recipe"
                            data-id="${escapeHtml(recipe.id)}"
                          >
                            <img
                              class="recipe-thumb"
                              src="${escapeHtml(recipe.imageUrl)}"
                              alt="${escapeHtml(recipe.name)}"
                              loading="lazy"
                              onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"
                            />
                            <div class="recipe-card-body">
                              <h3>${escapeHtml(recipe.name)}</h3>
                              <p>${escapeHtml(recipe.origin)} • ${formatTimeLabel(recipe.totalTimeMin)}</p>
                            </div>
                          </button>
                        </li>
                      `
                    )
                    .join("")}
                </ul>
              `
          }
        </div>
      </div>
    </section>
  `;
};

const renderTimeChips = (timings, total) => {
  const phases = [
    { key: "prep", label: "Preparation" },
    { key: "rest", label: "Resting" },
    { key: "cook", label: "Cooking" },
  ].filter((phase) => (timings[phase.key] ?? 0) > 0);

  return `
    <div class="time-grid">
      ${phases
        .map(
          (phase) => `
            <div class="time-chip">
              <strong>${phase.label}</strong>
              <span>${formatTimeLabel(timings[phase.key])}</span>
            </div>
          `
        )
        .join("")}
    </div>
    <p><strong>Total:</strong> ${formatTimeLabel(total)}</p>
  `;
};

const renderDetail = (recipe) => `
  <article class="detail-layout">
    <header class="screen-header">
      <button class="button" data-action="back-home">Back to recipes</button>
      <span class="status-pill">TasteAtlas-focused list rank #${recipe.rank}</span>
    </header>

    <img
      class="hero-image"
      src="${escapeHtml(recipe.imageUrl)}"
      alt="${escapeHtml(recipe.name)}"
      onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"
    />

    <section class="panel">
      <div class="overview-header">
        <h2>${escapeHtml(recipe.name)}</h2>
        <button class="button button-primary" data-action="start-cards">Cook this dish</button>
      </div>
      <p>${escapeHtml(recipe.summary)}</p>
      <p>${escapeHtml(recipe.history)}</p>
      <p>
        <a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noreferrer">
          ${escapeHtml(recipe.sourceLabel)}
        </a>
      </p>
      ${
        recipe.sourceRecipeTitle
          ? `<p class="muted"><strong>Matched recipe:</strong> ${escapeHtml(recipe.sourceRecipeTitle)}</p>`
          : ""
      }
      ${
        recipe.instructionsSource === "chef-curated-top10"
          ? `<p class="muted"><strong>Flow quality:</strong> Chef-curated detailed instructions (top 10 priority dish).</p>`
          : `<p class="muted"><strong>Flow quality:</strong> Serious Eats instruction scrape.</p>`
      }
      ${
        recipe.sourceNote
          ? `<p class="muted"><strong>Data note:</strong> ${escapeHtml(recipe.sourceNote)}</p>`
          : ""
      }
      ${
        recipe.imageSource
          ? `<p class="muted"><strong>Photo source:</strong> <a href="${escapeHtml(recipe.imageSource)}" target="_blank" rel="noreferrer">View image reference</a></p>`
          : ""
      }
    </section>

    <section class="panel">
      <h3>Cooking time</h3>
      ${renderTimeChips(recipe.timings, recipe.totalTimeMin)}
    </section>

    <section class="panel">
      <h3>Ingredients (base: ${recipe.basePortions} portions)</h3>
      <ul class="ingredients-list">
        ${recipe.ingredients
          .map(
            (ingredient) => `
              <li>${formatAmount(ingredient.amount, ingredient.unit)} ${escapeHtml(ingredient.name)}</li>
            `
          )
          .join("")}
      </ul>
    </section>

    <section class="panel">
      <h3>Full cooking timeline (${recipe.steps.length} steps)</h3>
      <ol class="detail-steps-list">
        ${recipe.steps
          .map(
            (step, index) => `
              <li>
                <h4>${index + 1}. ${escapeHtml(step.title)}</h4>
                <p>${escapeHtml(step.detail)}</p>
                <p class="muted">Phase: ${escapeHtml(step.phase)} • Duration: ${step.durationMin} min</p>
              </li>
            `
          )
          .join("")}
      </ol>
    </section>
  </article>
`;

const renderCookCards = (recipe, session, animateCard) => {
  const currentStep = recipe.steps[session.stepIndex];
  const nextStep =
    !session.completed && session.stepIndex < recipe.steps.length - 1
      ? recipe.steps[session.stepIndex + 1]
      : null;
  const totalSteps = recipe.steps.length;
  const currentStepNumber = Math.min(session.stepIndex + 1, totalSteps);
  const timerProgress = session.completed
    ? 100
    : getStepTimerProgressPercent(session, recipe);
  const status = session.completed
    ? "Completed"
    : session.paused
      ? "Paused"
      : "Running";
  const statusClass = session.completed
    ? "completed"
    : session.paused
      ? "paused"
      : "running";
  const nearingAutoAdvance =
    !session.completed &&
    !session.paused &&
    session.remainingSec > 0 &&
    session.remainingSec <= 3;

  return `
    <section class="cook-card-screen">
      <header class="screen-header">
        <button class="button" data-action="exit-cooking">Back to recipe</button>
        <h2 class="screen-title">${escapeHtml(recipe.name)} • Step ${currentStepNumber}/${totalSteps}</h2>
      </header>

      <section class="panel cook-step-card ${animateCard ? "card-wipe-in" : ""} ${nearingAutoAdvance ? "ending-soon" : ""}">
        <div class="step-topline">
          <span class="status-pill ${statusClass}">${status}</span>
          <span class="step-phase-pill">
            ${escapeHtml(currentStep.phase)} • ${currentStep.durationMin} min
          </span>
        </div>
        <p class="countdown countdown-hero ${nearingAutoAdvance ? "is-ending" : ""}">
          ${session.completed ? "00:00" : formatClock(session.remainingSec)}
        </p>
        ${
          nearingAutoAdvance
            ? `
              <p class="cue-note is-visible">
                Auto-advancing in ${session.remainingSec}s...
              </p>
            `
            : ""
        }

        <div class="progress-track progress-track-step" aria-hidden="true">
          <span style="width: ${timerProgress}%"></span>
        </div>

        <h3>${escapeHtml(currentStep.title)}</h3>
        <p class="step-detail">${escapeHtml(currentStep.detail)}</p>
        <p class="next-up">
          <strong>Next up:</strong>
          ${
            nextStep
              ? escapeHtml(nextStep.title)
              : "You are on the final step."
          }
        </p>

        <div class="card-tap-grid" aria-hidden="false">
          <button
            class="tap-zone"
            data-action="card-prev"
            aria-label="Go to previous step"
            ${session.stepIndex === 0 ? "disabled" : ""}
          ></button>
          <button
            class="tap-zone"
            data-action="card-next"
            aria-label="Go to next step"
            ${session.completed ? "disabled" : ""}
          ></button>
        </div>
      </section>

      <section class="panel cook-controls-bar">
        <div class="button-row cook-controls-row">
          <button
            class="button"
            data-action="card-prev"
            ${session.stepIndex === 0 ? "disabled" : ""}
          >
            Previous
          </button>
          <button
            class="button"
            data-action="toggle-pause"
            ${session.completed ? "disabled" : ""}
          >
            ${session.paused ? "Resume timer" : "Pause timer"}
          </button>
          <button
            class="button button-primary"
            data-action="card-next"
            ${session.completed ? "disabled" : ""}
          >
            Next
          </button>
          <button class="button" data-action="restart-cooking">Restart</button>
        </div>
      </section>
    </section>
  `;
};

const renderEmptySelection = () => `
  <section class="panel">
    <h2>No recipe selected</h2>
    <p>Please pick a recipe from the home list.</p>
    <button class="button" data-action="back-home">Go to home</button>
  </section>
`;

const render = () => {
  const recipe = getSelectedRecipe();
  let html = "";

  if (state.screen === "home") {
    html = renderHome();
  } else if (!recipe) {
    html = renderEmptySelection();
  } else if (state.screen === "detail") {
    html = renderDetail(recipe);
  } else if (state.screen === "cook-cards") {
    const session = state.cookSession;
    if (!session || session.recipeId !== recipe.id) {
      html = renderDetail(recipe);
      state.screen = "detail";
    } else {
      const animateCard = session.stepIndex !== lastRenderedActiveStep;
      html = renderCookCards(recipe, session, animateCard);
    }
  }

  app.innerHTML = html;

  if (state.screen === "cook-cards" && state.cookSession) {
    lastRenderedActiveStep = state.cookSession.stepIndex;
  } else {
    lastRenderedActiveStep = -1;
  }
};

app.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  const action = target.dataset.action;
  const recipe = getSelectedRecipe();

  switch (action) {
    case "open-recipe": {
      const id = target.dataset.id;
      if (!id || !recipeById.has(id)) {
        return;
      }
      state.selectedRecipeId = id;
      state.screen = "detail";
      state.cookSession = null;
      render();
      break;
    }
    case "back-home": {
      state.screen = "home";
      state.selectedRecipeId = null;
      state.cookSession = null;
      stopTicker();
      render();
      break;
    }
    case "start-cards": {
      if (!recipe) {
        return;
      }
      beginCookSession(recipe);
      break;
    }
    case "toggle-pause": {
      if (!state.cookSession || state.cookSession.completed) {
        return;
      }
      state.cookSession.paused = !state.cookSession.paused;
      if (!state.cookSession.paused) {
        ensureTicker();
      }
      render();
      break;
    }
    case "prev-step":
    case "card-prev": {
      shiftStepManually(-1);
      break;
    }
    case "next-step":
    case "card-next": {
      if (!state.cookSession || !recipe) {
        return;
      }
      if (state.cookSession.stepIndex >= recipe.steps.length - 1) {
        state.cookSession.completed = true;
        state.cookSession.paused = true;
        state.cookSession.remainingSec = 0;
        render();
        return;
      }
      shiftStepManually(1);
      break;
    }
    case "restart-cooking": {
      if (!recipe || !state.cookSession) {
        return;
      }
      state.cookSession.stepIndex = 0;
      state.cookSession.remainingSec = recipe.steps[0].durationSec;
      state.cookSession.paused = false;
      state.cookSession.completed = false;
      syncSessionToNonZeroStep(state.cookSession, recipe);
      ensureTicker();
      render();
      break;
    }
    case "exit-cooking": {
      state.screen = "detail";
      state.cookSession = null;
      stopTicker();
      render();
      break;
    }
    case "clear-filters": {
      state.filters.cuisine = "all";
      state.filters.timeBucket = "all";
      state.filters.ingredientIds = [];
      state.filters.ingredientQuery = "";
      render();
      break;
    }
    case "toggle-ingredient": {
      const ingredientId = target.dataset.id;
      if (!ingredientId || !INGREDIENT_OPTION_ID_SET.has(ingredientId)) {
        return;
      }
      const currentIds = new Set(state.filters.ingredientIds);
      if (currentIds.has(ingredientId)) {
        currentIds.delete(ingredientId);
      } else {
        currentIds.add(ingredientId);
      }
      state.filters.ingredientIds = Array.from(currentIds);
      render();
      break;
    }
    case "remove-ingredient": {
      const ingredientId = target.dataset.id;
      if (!ingredientId) {
        return;
      }
      state.filters.ingredientIds = state.filters.ingredientIds.filter(
        (id) => id !== ingredientId
      );
      render();
      break;
    }
    case "toggle-filters": {
      state.filtersPanelOpen = !state.filtersPanelOpen;
      render();
      break;
    }
    default:
      break;
  }
});

app.addEventListener("change", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    return;
  }

  if (target.dataset.action === "filter-cuisine") {
    const nextValue = target.value;
    state.filters.cuisine =
      nextValue === "all" || CUISINE_OPTION_SET.has(nextValue)
        ? nextValue
        : "all";
    render();
    return;
  }

  if (target.dataset.action === "filter-time") {
    const nextValue = target.value;
    state.filters.timeBucket = TIME_BUCKET_ID_SET.has(nextValue)
      ? nextValue
      : "all";
    render();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target.closest("[data-action='filter-ingredient-search']");
  if (!target) {
    return;
  }
  const nextValue = target.value ?? "";
  state.filters.ingredientQuery = nextValue;
  render();

  const nextInput = app.querySelector("#ingredient-filter-search");
  if (nextInput) {
    nextInput.focus();
    nextInput.setSelectionRange(nextValue.length, nextValue.length);
  }
});

let wasMobileViewport = isMobileViewport();
window.addEventListener("resize", () => {
  const isMobile = isMobileViewport();
  if (isMobile === wasMobileViewport) {
    return;
  }
  wasMobileViewport = isMobile;
  state.filtersPanelOpen = !isMobile;
  if (state.screen === "home") {
    render();
  }
});

render();
