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
  await expect(second.locator(".stats")).toContainText("2");
  await page.getByRole("button", { name: /Birch 3.*22% moisture/ }).click();
  await expect(page.locator(".tree-panel h2")).toHaveText("Birch 3");
  await expect(page.locator("blockquote")).toContainText("thirsty");
  await page.getByRole("button", { name: "Start a care session" }).click();
  await expect(page.getByText("Session: active")).toBeVisible();
  await page.getByText("Developer simulator · simulated hardware").click();
  await page
    .getByRole("button", { name: "Partial watering", exact: true })
    .click();
  await expect(page.locator(".measurements")).toContainText("24");
  await expect(page.locator(".stats")).toContainText("2");
  await page
    .getByRole("button", { name: "Verified recovery", exact: true })
    .click();
  await expect(page.getByText("Session: completed")).toBeVisible();
  await expect(page.locator(".stats")).toContainText("10");
  await expect(second.locator(".stats")).toContainText("3");
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
  await page.getByLabel("Tree photo").setInputFiles({
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

test("separate auth screens, database tree conversation and voice screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await page.screenshot({ path: "tests/e2e/auth-screen.png", fullPage: true });
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await page.getByRole("button", { name: "Play as Alex" }).click();
  await page.getByRole("button", { name: /Birch 3.*22% moisture/ }).click();
  await page
    .getByLabel("Message Birch 3")
    .fill("Who cares for you and what is your moisture?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".chat-bubble.assistant")).toContainText(
    "Maya Moss",
  );
  await expect(page.locator(".chat-bubble.assistant")).toContainText("22%");
  await page
    .getByRole("button", { name: "Voice conversation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Tree voice conversation" }),
  ).toBeVisible();
  await expect(page.locator(".voice-orb")).toBeVisible();
  await page.screenshot({ path: "tests/e2e/voice-screen.png", fullPage: true });
  await page.getByRole("button", { name: "Close voice" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.locator(".chat-bubble")).toHaveCount(0);
});

test("account creation opens the homepage with the new caretaker profile", async ({
  page,
}) => {
  const email = `signup-${Date.now()}@treequest.local`;
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "New here? Create an account" })
      .click();
    await page.getByLabel("Your name", { exact: true }).fill("New caretaker");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page
      .getByLabel("Password", { exact: true })
      .fill("Local-verification-2026");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(page.locator(".profile")).toContainText("New caretaker");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
  } finally {
    const sql = postgres(
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    );
    await sql`delete from auth.users where email=${email}`;
    await sql.end();
  }
});
