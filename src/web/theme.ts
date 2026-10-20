// Light or dark, following the device until the visitor presses the toggle.
// The choice lasts only as long as the page: nothing is written to browser
// storage (ADR-0001).

export type Theme = "light" | "dark";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

export function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return prefersDark.matches ? "dark" : "light";
}

const toggle = document.getElementById("theme-toggle");
if (toggle) {
  // The button names the theme it switches to.
  const sync = () => (toggle.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode");
  toggle.addEventListener("click", () => {
    document.documentElement.dataset.theme = currentTheme() === "dark" ? "light" : "dark";
    sync();
  });
  prefersDark.addEventListener("change", sync);
  sync();
}
