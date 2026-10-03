import { $, $$ } from "../core/dom.js";

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // Stockage indisponible (navigation privée, fichier local restreint) : réglage non mémorisé.
  }
  return null;
}

// ——— Thème ———

const THEME_COLORS = { dark: "#0a0b0f", light: "#f2f7f6" };

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  $('meta[name="theme-color"]').setAttribute("content", THEME_COLORS[theme]);
  const next = theme === "dark" ? "clair" : "sombre";
  $("#themeText").textContent = `Thème ${next}`;
  $("#themeIcon").textContent = theme === "dark" ? "☀" : "◐";
  $("#themeBtn").setAttribute("aria-label", `Passer au thème ${next}`);
  if (persist) store("cdqp-theme", theme);
}

export function initTheme() {
  const saved = store("cdqp-theme");
  const media = matchMedia("(prefers-color-scheme: light)");
  applyTheme(saved === "light" || saved === "dark" ? saved : media.matches ? "light" : "dark", false);
  media.addEventListener?.("change", (e) => {
    if (!store("cdqp-theme")) applyTheme(e.matches ? "light" : "dark", false);
  });
  $("#themeBtn").addEventListener("click", () =>
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true),
  );
}

// ——— Animations ———

function applyMotion(enabled, persist) {
  document.documentElement.dataset.motion = enabled ? "on" : "off";
  $("#motionState").textContent = enabled ? "ON" : "OFF";
  $("#motionBtn").setAttribute("aria-pressed", String(enabled));
  if (persist) store("cdqp-motion", enabled ? "on" : "off");
}

export function initMotion() {
  const saved = store("cdqp-motion");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  applyMotion(saved ? saved === "on" : !reduced, false);
  $("#motionBtn").addEventListener("click", () =>
    applyMotion(document.documentElement.dataset.motion !== "on", true),
  );
}

// ——— Navigation par ancre (#convertir, #optimiser, #fusionner, #decouper) ———

const TITLES = {
  convertir: "Convertir",
  optimiser: "Optimiser",
  fusionner: "Fusionner",
  decouper: "Découper",
};

export function initRouter({ onRoute = () => {} } = {}) {
  const sections = $$("[data-route]");
  const tabs = $$("[data-tab]");
  let first = true;

  const selectTab = (name) => {
    tabs.forEach((tab) => {
      const on = tab.dataset.tab === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !on;
    });
  };

  const route = () => {
    const hash = decodeURIComponent(location.hash.slice(1));
    const target =
      sections.find((s) => s.dataset.route.split(" ").includes(hash)) ||
      sections.find((s) => s.dataset.route === "");
    sections.forEach((s) => (s.hidden = s !== target));
    if (hash === "fusionner" || hash === "decouper") selectTab(hash);
    document.title = TITLES[hash]
      ? `${TITLES[hash]} — CDQP Offline File Toolkit`
      : "CDQP Offline File Toolkit";
    if (!first) {
      window.scrollTo({
        top: 0,
        behavior: document.documentElement.dataset.motion === "on" ? "smooth" : "auto",
      });
      // Le focus suit la navigation pour les lecteurs d'écran.
      ($("h2[tabindex]", target) || $("#main")).focus({ preventScroll: true });
    }
    first = false;
    onRoute(hash);
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => {
      history.replaceState(null, "", `#${tab.dataset.tab}`);
      route();
      tab.focus();
    });
    tab.addEventListener("keydown", (e) => {
      const delta = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!delta) return;
      e.preventDefault();
      tabs[(i + delta + tabs.length) % tabs.length].click();
    });
  });
  window.addEventListener("hashchange", route);
  route();
}
