import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    // The full app (FastAPI + static frontend) is served by Docker on port 8000.
    baseURL: "http://127.0.0.1:8000",
    trace: "retain-on-failure",
    // Wide enough that the 5 board columns render in a single row beside the
    // chat sidebar, keeping drag-and-drop geometry stable in the e2e tests.
    viewport: { width: 1680, height: 950 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
