import { defineConfig, devices } from "@playwright/test";
const port = process.env.TEST_PORT || "5173";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -w @treequest/web -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
