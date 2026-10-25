import { expect, test } from "@playwright/test";

for (const systemTheme of ["light", "dark"] as const) {
  test(`shadow theme overrides ${systemTheme} system colors with minified CSS`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: systemTheme });
    await page.goto("/planner-staging.html");
    await page.evaluate(async () => {
      const domPath = "/src/utils/dom.ts";
      const cssPath = "/src/index.css?inline";
      const [
        { extensionCssForShadowRoot, ensureOverlayContainer },
        { default: css },
      ] = await Promise.all([import(domPath), import(cssPath)]);
      document.getElementById("root")!.hidden = true;
      document
        .getElementById("extension-overlay-root")
        ?.setAttribute("id", "hidden-staging-overlay");
      // Production minification removes optional attribute-value quotes.
      const minifiedSelectors = css.replace(
        /data-mpp-theme="(light|dark)"/g,
        "data-mpp-theme=$1",
      );
      const drawer = ensureOverlayContainer(
        extensionCssForShadowRoot(minifiedSelectors),
      );
      drawer.innerHTML =
        '<div class="planner-dialog-content"><h1>Pack Planner</h1><div data-slot="card">Course information</div></div>';
    });
    for (const theme of ["light", "dark", "light"] as const) {
      await page.evaluate((mode) => {
        const host = document.getElementById("extension-overlay-root")!;
        host.dataset.mppTheme = mode;
        host.shadowRoot!.querySelectorAll(".mypack-shell").forEach((shell) => {
          shell.classList.toggle("dark", mode === "dark");
        });
      }, theme);
      const colors = await page
        .locator("#extension-overlay-root .planner-dialog-content")
        .evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            foreground: style.color,
            background: style.getPropertyValue("--background").trim(),
            gradient: style.backgroundImage,
          };
        });
      expect(colors.foreground).toBe(
        theme === "light" ? "rgb(15, 23, 42)" : "rgb(241, 245, 255)",
      );
      expect(colors.background).toBe(theme === "light" ? "#f7f9fc" : "#080f1a");
      expect(colors.gradient).toContain(
        theme === "light" ? "rgb(251, 252, 254)" : "rgb(14, 22, 38)",
      );
    }
  });
}
