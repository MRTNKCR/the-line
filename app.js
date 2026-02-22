import { RECIPES } from "./data/recipes.js";

const app = document.querySelector("#app");
const recipeById = new Map(RECIPES.map((recipe) => [recipe.id, recipe]));

const FALLBACK_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="100%" height="100%" fill="white"/><rect x="24" y="24" width="912" height="592" fill="none" stroke="black" stroke-width="8"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="black" font-size="42" font-family="Arial">Dish photo</text></svg>'
  );

const state = {
  screen: "home", // home | detail | setup | cooking
  selectedRecipeId: null,
  portions: 4,
  cookSession: null,
};

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

const scaleIngredients = (recipe, portions) =>
  recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    scaledAmount: (ingredient.amount * portions) / recipe.basePortions,
  }));

const stopTicker = () => {
  if (!ticker) {
    return;
  }
  clearInterval(ticker);
  ticker = null;
};

const ensureTicker = () => {
  if (ticker) {
    return;
  }
  ticker = setInterval(() => {
    const session = state.cookSession;
    if (!session || state.screen !== "cooking" || session.paused || session.completed) {
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
        session.remainingSec = recipe.steps[session.stepIndex].durationSec;
      } else {
        session.completed = true;
        session.paused = true;
      }
    }

    render();
  }, 1000);
};

const beginCookSession = (recipe, portions) => {
  state.cookSession = {
    recipeId: recipe.id,
    portions,
    stepIndex: 0,
    remainingSec: recipe.steps[0].durationSec,
    paused: false,
    completed: false,
  };
  state.screen = "cooking";
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
  session.remainingSec = recipe.steps[nextIndex].durationSec;
  session.completed = false;
  render();
};

const renderHome = () => `
  <section>
    <header class="screen-header">
      <div>
        <h2 class="screen-title">Global dish list</h2>
        <p class="muted">${RECIPES.length} recipes • no filters • one list</p>
      </div>
    </header>
    <ul class="recipe-list">
      ${RECIPES.map(
        (recipe) => `
          <li class="recipe-card">
            <button
              class="recipe-card-button"
              data-action="open-recipe"
              data-id="${escapeHtml(recipe.id)}"
            >
              <img
                class="recipe-thumb"
                src="${escapeHtml(recipe.imageThumbUrl)}"
                alt="${escapeHtml(recipe.name)}"
                onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"
              />
              <div class="recipe-card-body">
                <h3>${escapeHtml(recipe.name)}</h3>
                <p>${escapeHtml(recipe.origin)} • ${formatTimeLabel(recipe.totalTimeMin)}</p>
              </div>
            </button>
          </li>
        `
      ).join("")}
    </ul>
  </section>
`;

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

    <div class="button-row">
      <button class="button" data-action="back-home">Back to home</button>
      <button class="button button-primary" data-action="to-setup">Cook this dish</button>
    </div>
  </article>
`;

const renderSetup = (recipe) => {
  const scaledIngredients = scaleIngredients(recipe, state.portions);

  return `
    <section class="setup-grid">
      <header class="screen-header">
        <button class="button" data-action="back-detail">Back to recipe</button>
        <h2 class="screen-title">Prepare: ${escapeHtml(recipe.name)}</h2>
      </header>

      <section class="panel">
        <h3>1) Select portions</h3>
        <div class="portion-control">
          <label for="portion-input">Portions</label>
          <input
            id="portion-input"
            type="number"
            min="1"
            max="20"
            step="1"
            value="${state.portions}"
            data-action="change-portions"
          />
        </div>
      </section>

      <section class="panel">
        <h3>2) Ingredients for ${state.portions} portions (metric)</h3>
        <ul class="ingredients-list">
          ${scaledIngredients
            .map(
              (ingredient) => `
                <li>${formatAmount(ingredient.scaledAmount, ingredient.unit)} ${escapeHtml(ingredient.name)}</li>
              `
            )
            .join("")}
        </ul>
      </section>

      <div class="button-row">
        <button class="button button-primary" data-action="start-cooking">Cook now</button>
      </div>
    </section>
  `;
};

const renderCooking = (recipe, session) => {
  const currentStep = recipe.steps[session.stepIndex];
  const status = session.completed
    ? "Completed"
    : session.paused
      ? "Paused (manual mode)"
      : "Running (auto mode)";

  return `
    <section class="setup-grid">
      <header class="screen-header">
        <button class="button" data-action="exit-cooking">Exit cooking</button>
        <h2 class="screen-title">${escapeHtml(recipe.name)} • step ${session.stepIndex + 1}/${recipe.steps.length}</h2>
      </header>

      <section class="panel">
        <div class="button-row">
          <span class="status-pill ${session.paused ? "" : "running"}">${status}</span>
          <span class="countdown">Time left: ${formatClock(session.remainingSec)}</span>
        </div>
        <h3>${escapeHtml(currentStep.title)}</h3>
        <p>${escapeHtml(currentStep.detail)}</p>
        <p class="muted">
          Phase: ${escapeHtml(currentStep.phase)} • Planned duration: ${currentStep.durationMin} min
        </p>
        <div class="button-row">
          <button class="button" data-action="prev-step" ${session.stepIndex === 0 ? "disabled" : ""}>
            Previous step
          </button>
          <button
            class="button"
            data-action="toggle-pause"
            ${session.completed ? "disabled" : ""}
          >
            ${session.paused ? "Resume auto flow" : "Pause auto flow"}
          </button>
          <button
            class="button"
            data-action="next-step"
            ${session.stepIndex >= recipe.steps.length - 1 ? "disabled" : ""}
          >
            Next step
          </button>
          <button class="button" data-action="restart-cooking">Restart</button>
        </div>
      </section>

      <section class="panel">
        <h3>Vertical timeline</h3>
        <ol class="timeline">
          ${recipe.steps
            .map((step, index) => {
              const stateClass =
                index < session.stepIndex
                  ? "done"
                  : index === session.stepIndex
                    ? "active"
                    : "";

              return `
                <li class="timeline-step ${stateClass}" data-step-item="${index}">
                  <h4>${index + 1}. ${escapeHtml(step.title)}</h4>
                  <p>${escapeHtml(step.detail)}</p>
                  <div class="timeline-meta">
                    <span>Phase: ${escapeHtml(step.phase)}</span>
                    <span>Duration: ${step.durationMin} min</span>
                  </div>
                </li>
              `;
            })
            .join("")}
        </ol>
      </section>
      <p class="footer-note">
        Auto flow switches steps when timer reaches zero. You can pause anytime and continue manually.
      </p>
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
  } else if (state.screen === "setup") {
    html = renderSetup(recipe);
  } else if (state.screen === "cooking") {
    const session = state.cookSession;
    if (!session || session.recipeId !== recipe.id) {
      html = renderSetup(recipe);
      state.screen = "setup";
    } else {
      html = renderCooking(recipe, session);
    }
  }

  app.innerHTML = html;

  if (state.screen === "cooking" && state.cookSession) {
    const activeIndex = state.cookSession.stepIndex;
    if (activeIndex !== lastRenderedActiveStep) {
      lastRenderedActiveStep = activeIndex;
      const activeNode = app.querySelector(`[data-step-item="${activeIndex}"]`);
      activeNode?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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
      state.portions = recipeById.get(id).basePortions;
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
    case "to-setup": {
      if (!recipe) {
        return;
      }
      state.screen = "setup";
      state.portions = recipe.basePortions;
      render();
      break;
    }
    case "back-detail": {
      state.screen = "detail";
      render();
      break;
    }
    case "start-cooking": {
      if (!recipe) {
        return;
      }
      beginCookSession(recipe, state.portions);
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
    case "prev-step": {
      shiftStepManually(-1);
      break;
    }
    case "next-step": {
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
      ensureTicker();
      render();
      break;
    }
    case "exit-cooking": {
      state.screen = "setup";
      state.cookSession = null;
      stopTicker();
      render();
      break;
    }
    default:
      break;
  }
});

app.addEventListener("input", (event) => {
  const target = event.target.closest("[data-action='change-portions']");
  if (!target) {
    return;
  }

  const raw = Number.parseInt(target.value, 10);
  if (Number.isNaN(raw)) {
    return;
  }

  state.portions = Math.max(1, Math.min(20, raw));
  target.value = state.portions;
  render();
});

render();
