import { test, expect } from "@playwright/test";
import postgres from "postgres";
test.beforeEach(async () => {
  const sql = postgres(
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  );
  await sql`select reset_demo()`;
  await sql.end();
});
test("map, partial watering, verified capture, territory, analytics and realtime", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Play as Alex" }).click();
  await expect(page.getByText("Alex Fern").first()).toBeVisible();
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator(".stats")).toContainText("7");
  await page.getByRole("button", { name: /Oak 8.*22% moisture/ }).click();
  await expect(page.locator(".tree-panel h2")).toHaveText("Oak 8");
  await expect(page.locator("blockquote")).toContainText("thirsty");
  await page.getByRole("button", { name: "Start a care session" }).click();
  await expect(page.getByText("Session: active")).toBeVisible();
  await page.getByText("Developer simulator · simulated hardware").click();
  await page
    .getByRole("button", { name: "Partial watering", exact: true })
    .click();
  await expect(page.locator(".measurements")).toContainText("24");
  await expect(page.locator(".stats")).toContainText("7");
  await page
    .getByRole("button", { name: "Verified recovery", exact: true })
    .click();
  await expect(page.getByText("Session: completed")).toBeVisible();
  await expect(page.locator(".stats")).toContainText("10");
  await expect(second.locator(".stats")).toContainText("8");
  await expect(page.locator(".stats>div").nth(2)).toContainText("1");
  await page.getByRole("button", { name: "Ask my trees", exact: true }).click();
  await page
    .getByRole("button", { name: "Ask my trees", exact: true })
    .last()
    .click();
  await expect(page.locator(".answer")).toContainText("SIMULATED HISTORY");
  await expect(page.locator(".analytics-cards")).toContainText(
    "Latest delivered in period",
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: "tests/e2e/desktop-demo.png", fullPage: true });
});
test("responsive map and registration demo identification", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Play as Alex" }).click();
  await expect(page.locator(".tree-list")).toBeVisible();
  await page.getByRole("button", { name: "Register a tree" }).click();
  await page
    .getByLabel("Tree photo")
    .setInputFiles({
      name: "tree.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.getByRole("dialog")).toContainText(
    "Simulated identification",
  );
  await page.getByLabel("Name", { exact: true }).fill("New demo tree");
  await page
    .getByRole("button", { name: "Register tree", exact: true })
    .click();
  await expect(page.locator(".tree-panel h2")).toHaveText("New demo tree");
  await expect(page.locator(".tree-panel")).toContainText(
    "Unidentified species",
  );
  await page.screenshot({ path: "tests/e2e/mobile-demo.png", fullPage: true });
});
