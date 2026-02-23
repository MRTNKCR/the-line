import { RECIPES } from "./data/recipes.js";

const app = document.querySelector("#app");
const recipeById = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="100%" height="100%" fill="white"/><rect x="24" y="24" width="912" height="592" fill="none" stroke="black" stroke-width="8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="black" font-size="42" font-family="Arial">Dish photo</text></svg>'
  );

const state = {
  screen: "home", // home | detail | cook-cards
  selectedRecipeId: null,
  cookSession: null,
  filters: {
    cuisine: "all",
    timeBucket: "all",
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

const getCompletedStepCount = (session) => {
  if (!session) {
    return 0;
  }
  return Math.max(0, session.stepIndex);
};

const getOverallProgressPercent = (session, recipe) => {
  if (!session || !recipe || recipe.steps.length === 0) {
    return 0;
  }
  if (session.completed) {
    return 100;
  }
  const completed = getCompletedStepCount(session);
  return Math.max(0, Math.min(100, Math.round((completed / recipe.steps.length) * 100)));
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

const getFilteredRecipes = () =>
  RECIPES.filter((recipe) => {
    const cuisinePass =
      state.filters.cuisine === "all" || recipe.origin === state.filters.cuisine;
    const timePass = matchesTimeBucket(recipe.totalTimeMin, state.filters.timeBucket);
    return cuisinePass && timePass;
  });

const renderHome = () => {
  const filteredRecipes = getFilteredRecipes();
  const hasActiveFilters =
    state.filters.cuisine !== "all" || state.filters.timeBucket !== "all";

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
            <h3>Filters</h3>
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

const renderTimeChips = (timings, total) => `
  <div class="time-grid">
    <div class="time-chip">
      <strong>Preparation</strong>
      <span>${formatTimeLabel(timings.prep)}</span>
    </div>
    <div class="time-chip">
      <strong>Resting</strong>
      <span>${formatTimeLabel(timings.rest)}</span>
    </div>
    <div class="time-chip">
      <strong>Cooking</strong>
      <span>${formatTimeLabel(timings.cook)}</span>
    </div>
  </div>
  <p><strong>Total:</strong> ${formatTimeLabel(total)}</p>
`;

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
      <h2>${escapeHtml(recipe.name)}</h2>
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

    <div class="button-row">
      <button class="button" data-action="back-home">Back to home</button>
      <button class="button button-primary" data-action="start-cards">Cook this dish</button>
    </div>
  </article>
`;

const renderCookCards = (recipe, session, animateCard) => {
  const currentStep = recipe.steps[session.stepIndex];
  const totalSteps = recipe.steps.length;
  const completedSteps = session.completed
    ? totalSteps
    : getCompletedStepCount(session);
  const overallProgress = getOverallProgressPercent(session, recipe);
  const timerProgress = session.completed
    ? 100
    : getStepTimerProgressPercent(session, recipe);
  const status = session.completed
    ? "Completed"
    : session.paused
      ? "Paused"
      : "Running";

  return `
    <section class="cook-card-screen">
      <header class="screen-header">
        <button class="button" data-action="exit-cooking">Back to recipe</button>
        <h2 class="screen-title">${escapeHtml(recipe.name)} • Step ${Math.min(session.stepIndex + 1, totalSteps)}/${totalSteps}</h2>
      </header>

      <section class="panel cook-overall-progress">
        <p class="muted">
          <strong>${completedSteps} / ${totalSteps}</strong> steps completed
        </p>
        <div class="progress-track" aria-hidden="true">
          <span style="width: ${overallProgress}%"></span>
        </div>
      </section>

      <section class="panel cook-step-card ${animateCard ? "card-wipe-in" : ""}">
        <div class="button-row">
          <span class="status-pill ${session.paused ? "" : "running"}">${status}</span>
          <span class="countdown">Time left: ${session.completed ? "00:00" : formatClock(session.remainingSec)}</span>
        </div>
        <h3>${escapeHtml(currentStep.title)}</h3>
        <p>${escapeHtml(currentStep.detail)}</p>
        <p class="muted">Phase: ${escapeHtml(currentStep.phase)} • Planned duration: ${currentStep.durationMin} min</p>

        <div class="progress-track" aria-hidden="true">
          <span style="width: ${timerProgress}%"></span>
        </div>
        <p class="muted tap-hint">Tap left half for previous step, right half for next step.</p>

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

      <section class="panel">
        <div class="button-row">
          <button
            class="button"
            data-action="toggle-pause"
            ${session.completed ? "disabled" : ""}
          >
            ${session.paused ? "Resume timer" : "Pause timer"}
          </button>
          <button class="button" data-action="restart-cooking">Restart from step 1</button>
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

render();
