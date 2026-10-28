import { expect, test, type Page, type Frame } from "@playwright/test";

import type { ReviewWindow } from "../fixtures/cartReviewTypes";

// Production update hook + cart service in separate browser realms. Chrome
// messaging is a boundary spy; this never reloads a user's real extension.
async function installUpdateSpy(target: Page | Frame) {
  await target.evaluate(async () => {
    const original = chrome.runtime.sendMessage;
    Object.assign(window, { reviewUpdateMessages: 0 });
    chrome.runtime.sendMessage = ((
      message: { type: string },
      ...args: unknown[]
    ) => {
      if (message.type === "mypack-apply-update") {
        (window as unknown as ReviewWindow).reviewUpdateMessages++;
        return Promise.resolve();
      }
      return (original as unknown as (...args: unknown[]) => unknown)(
        message,
        ...args,
      );
    }) as typeof original;
    await chrome.storage.local.set({ "mypack.pendingUpdate": "99.0.0" });
    const path = "/tests/fixtures/cartReviewHarness.tsx";
    const { mountUpdateReview } = await import(path);
    mountUpdateReview();
  });
}

async function pauseLabChange(page: Page) {
  await page.evaluate(async () => {
    const fixturePath = "/tests/fixtures/cartReviewHarness.tsx";
    const cartPath = "/src/course-management/services/replaceCartSection.ts";
    const { section } = await import(fixturePath);
    const { changeCartLab } = await import(cartPath);
    const original = window.fetch;
    const state = {
      entered: false,
      release: () => {},
      done: Promise.resolve() as Promise<unknown>,
    };
    Object.assign(window, { reviewSwap: state });
    window.fetch = async (...args) => {
      if (String(args[0]).includes("IScript_addClassToShopCart")) {
        state.entered = true;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
      }
      return original(...args);
    };
    state.done = changeCartLab(
      section("11111"),
      section("33333", "LAB"),
      section("44444", "LAB"),
    );
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as ReviewWindow).reviewSwap.entered,
      ),
    )
    .toBe(true);
}

for (const realm of ["same-page", "other-tab", "iframe"] as const) {
  test(`cart review: Update now waits for pending swap in ${realm}`, async ({
    page,
    context,
  }) => {
    await page.goto("/planner-staging.html?tab=schedule");
    await page.getByRole("button", { name: "Close planner" }).click();
    let target: Page | Frame = page;
    if (realm === "other-tab") {
      target = await context.newPage();
      await target.goto("/planner-staging.html?tab=schedule");
      await target.getByRole("button", { name: "Close planner" }).click();
    } else if (realm === "iframe") {
      await page.evaluate(() => {
        const frame = document.createElement("iframe");
        frame.name = "review-frame";
        frame.src = "/planner-staging.html?tab=schedule";
        frame.style.cssText =
          "position:fixed;inset:0;width:100%;height:100%;z-index:2147483647";
        document.body.append(frame);
      });
      await expect.poll(() => Boolean(page.frame("review-frame"))).toBe(true);
      target = page.frame("review-frame")!;
      await target.getByRole("button", { name: "Close planner" }).click();
    }
    await installUpdateSpy(target);
    await pauseLabChange(page);
    await target
      .locator("#cart-review-update")
      .getByRole("button", { name: "Update now" })
      .click();
    await expect(
      target
        .locator("#cart-review-update")
        .getByRole("button", { name: "Updating…" }),
    ).toBeVisible();
    const premature = await target.evaluate(
      () => (window as unknown as ReviewWindow).reviewUpdateMessages,
    );
    // Release even when the assertion will fail, so pending requests never leak.
    await page.evaluate(async () => {
      (window as unknown as ReviewWindow).reviewSwap.release();
      await (window as unknown as ReviewWindow).reviewSwap.done;
    });
    await expect
      .poll(() =>
        target.evaluate(
          () => (window as unknown as ReviewWindow).reviewUpdateMessages,
        ),
      )
      .toBe(1);
    expect(premature).toBe(0);
  });
}

for (const interruption of ["navigation", "close"] as const) {
  test(`cart review: reopening after ${interruption} recovers or reports interrupted swap`, async ({
    page,
    context,
  }) => {
    // The simulated server commits delete, then never receives the held add.
    // Keep extension storage across document lifetimes, unlike staging's
    // default per-page stub, so recovery has a realistic place to persist work.
    const persistent: Record<string, unknown> = {};
    await context.exposeBinding(
      "reviewPersistentStorage",
      (_source, method, value) => {
        if (method === "seed") {
          for (const [key, item] of Object.entries(value))
            if (!(key in persistent)) persistent[key] = item;
        } else if (method === "set") Object.assign(persistent, value);
        else if (method === "remove")
          for (const key of [value].flat()) delete persistent[key];
        else if (method === "get") {
          const keys =
            value == null
              ? Object.keys(persistent)
              : typeof value === "string"
                ? [value]
                : Array.isArray(value)
                  ? value
                  : Object.keys(value);
          return Object.fromEntries(
            keys.map((key: string) => [key, persistent[key]]),
          );
        }
      },
    );
    await context.addInitScript(() => {
      const define = Object.defineProperty;
      Object.defineProperty = ((
        target: object,
        key: PropertyKey,
        descriptor: PropertyDescriptor,
      ) => {
        if (
          target === globalThis &&
          key === "chrome" &&
          descriptor.value?.storage?.local
        ) {
          const local = descriptor.value.storage.local;
          const originalGet = local.get.bind(local),
            originalSet = local.set.bind(local);
          const call = (method: string, value: unknown) =>
            (window as unknown as ReviewWindow).reviewPersistentStorage(
              method,
              value,
            );
          const ready = originalGet(null).then((seed: unknown) =>
            call("seed", seed),
          );
          local.get = async (keys: unknown) => {
            await ready;
            return call("get", keys);
          };
          local.set = async (items: unknown) => {
            await ready;
            await call("set", items);
            await originalSet(items);
          };
          local.remove = async (keys: unknown) => {
            await ready;
            await call("remove", keys);
          };
        }
        return define(target, key, descriptor);
      }) as typeof Object.defineProperty;
    });
    let serverHasCourse = true;
    await page.exposeFunction("reviewDeleteCommitted", () => {
      serverHasCourse = false;
    });
    await page.goto("/planner-staging.html?tab=schedule");
    await page.evaluate(() => {
      const original = window.fetch;
      window.fetch = async (...args) => {
        if (String(args[0]).includes("IScript_deleteClassOnShopCart"))
          await (window as unknown as ReviewWindow).reviewDeleteCommitted();
        return original(...args);
      };
    });
    await pauseLabChange(page);
    expect(serverHasCourse).toBe(false);
    let reopened = page;
    if (interruption === "close") {
      await page.close();
      reopened = await context.newPage();
    } else await page.goto("about:blank");
    await reopened.goto("/planner-staging.html?tab=schedule");
    // No synthetic original row is seeded by this fixture on reopen. Existing
    // unrelated demo courses are not evidence of transaction recovery.
    const recovery = reopened
      .getByRole("alert")
      .filter({ hasText: /interrupted|recover|put.*back/i });
    await expect(recovery).toBeVisible();
  });
}
