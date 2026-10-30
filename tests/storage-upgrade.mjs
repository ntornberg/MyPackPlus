// Run after npm run build. Uses a disposable profile and simulated MyPack pages.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
await mkdir(path.join(root, "test-results"), { recursive: true });
const work = await mkdtemp(path.join(root, "test-results", "storage-upgrade-"));
const extension = path.join(work, "extension");
await mkdir(extension);
const manifest = JSON.parse(
  await readFile(path.join(root, "dist/manifest.json"), "utf8"),
);
assert.equal(manifest.version, "3.8.18");
// An older-version fixture with the same extension ID and storage layout.
await writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "MyPack upgrade fixture",
    version: "3.8.16",
    permissions: ["storage"],
    host_permissions: manifest.host_permissions,
    background: { service_worker: "old-worker.js" },
  }),
);
await writeFile(
  path.join(extension, "old-worker.js"),
  "chrome.runtime.onMessage.addListener(() => {});",
);
await writeFile(
  path.join(extension, "upgrade-check.html"),
  "<!doctype html><title>Upgrade check</title>",
);

const profile = path.join(work, "profile");
await mkdir(path.join(profile, "Default"), { recursive: true });
await writeFile(
  path.join(profile, "Default", "Preferences"),
  JSON.stringify({
    extensions: { ui: { developer_mode: true } },
  }),
);
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ],
});
context.setDefaultTimeout(15000);
const html = `<html><body>Simulated MyPack
<script>sessionStorage.setItem('websiteLoads', String(Number(sessionStorage.getItem('websiteLoads')) + 1));</script>
</body></html>`;
await context.route("https://**.acs.ncsu.edu/**", (route) =>
  route.fulfill({ contentType: "text/html", body: html }),
);

async function seedDatabase() {
  for (const name of ["mypack-extension-cache", "website-database"]) {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("cache-store", { keyPath: "key" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("cache-store", "readwrite");
        tx.objectStore("cache-store").put({
          key: "unknown-legacy",
          value: "keep only in website database",
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }
}

async function databaseKeys(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("cache-store", "readonly");
      const keys = tx.objectStore("cache-store").getAllKeys();
      tx.oncomplete = () => {
        db.close();
        resolve(keys.result);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

try {
  const extensionsPage = await context.newPage();
  await extensionsPage.goto("chrome://extensions");
  await extensionsPage.evaluate(() =>
    chrome.developerPrivate.updateProfileConfiguration({
      inDeveloperMode: true,
    }),
  );
  await extensionsPage.close();
  const oldWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await oldWorker.evaluate(async () => {
    for (const area of [
      chrome.storage.local,
      chrome.storage.sync,
      chrome.storage.session,
    ]) {
      await area.set({ unknownLegacy: "old", degreeAudits: { old: true } });
    }
  });
  await oldWorker.evaluate(seedDatabase);
  const pages = await Promise.all([
    context.newPage(),
    context.newPage(),
    context.newPage(),
  ]);
  await Promise.all(
    pages.map((page, index) =>
      page.goto(
        index === 2
          ? "https://webappprd.acs.ncsu.edu/"
          : "https://portalsp.acs.ncsu.edu/",
      ),
    ),
  );
  for (const page of pages) {
    await page.evaluate(() => {
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of [
          "mypack-pack-planner-session-v1",
          "mypack-pack-planner-selected-tab-v1",
          "mypack-theme-mode",
          "mypack.extensionInfoHidden",
          "mypack.whatsNewSeenVersion",
          "firstStartDismissed",
          "mypack-course-sections-v1:old",
        ]) {
          storage.setItem(key, "legacy");
        }
        storage.setItem("websitePreference", "keep");
      }
    });
    await page.evaluate(seedDatabase);
  }
  await cp(path.join(root, "dist"), extension, { recursive: true });
  const replacement = context.waitForEvent("serviceworker", {
    predicate: (worker) => !worker.url().endsWith("old-worker.js"),
  });
  await oldWorker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  const worker = await replacement;
  for (const page of pages) {
    await page.waitForFunction(
      () => sessionStorage.getItem("mypack.storageRevision") === "1",
    );
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("websiteLoads")),
      "2",
      "Tab must automatically reload once",
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("websitePreference")),
      "keep",
    );
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem("websitePreference")),
      "keep",
    );
    assert.equal(
      await page.evaluate(() =>
        sessionStorage.getItem("mypack-course-sections-v1:old"),
      ),
      null,
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("mypack-pack-planner-session-v1"),
      ),
      null,
    );
    assert.deepEqual(
      await page.evaluate(databaseKeys, "mypack-extension-cache"),
      ["__meta:storageRevision"],
    );
    assert.deepEqual(await page.evaluate(databaseKeys, "website-database"), [
      "unknown-legacy",
    ]);
  }
  const storage = await worker.evaluate(async () => ({
    local: await chrome.storage.local.get(null),
    sync: await chrome.storage.sync.get(null),
    session: await chrome.storage.session.get(null),
  }));
  assert.equal(storage.local["mypack.storageRevision"], 1);
  assert.equal(storage.local.unknownLegacy, undefined);
  assert.deepEqual(storage.sync, {});
  assert.deepEqual(storage.session, {});
  assert.deepEqual(
    await worker.evaluate(databaseKeys, "mypack-extension-cache"),
    ["__meta:storageRevision"],
  );

  await pages[0].evaluate(() =>
    localStorage.setItem("mypack-theme-mode", "dark"),
  );
  await pages[0].reload();
  await pages[0].waitForFunction(
    () => localStorage.getItem("mypack-theme-mode") === "dark",
  );
  const restarted = context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
  const nextWorker = await restarted;
  const checkPage = await context.newPage();
  await checkPage.goto(new URL("upgrade-check.html", nextWorker.url()).href);
  await checkPage.evaluate(() =>
    chrome.runtime.sendMessage({ type: "mypack-storage-ready" }),
  );
  assert.equal(
    await pages[1].evaluate(() => sessionStorage.getItem("websiteLoads")),
    "2",
    "Repeated update must not reload tabs",
  );
  assert.equal(
    await pages[0].evaluate(() => localStorage.getItem("mypack-theme-mode")),
    "dark",
  );
  console.log(
    "PASS: real Chromium fixture upgrade, three tabs/two origins, all storage layers, unrelated data preserved, no repeat reset/reload.",
  );
} finally {
  await context.close();
}
