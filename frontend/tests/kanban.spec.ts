import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const DEFAULT_BOARD = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    {
      id: "col-progress",
      title: "In Progress",
      cardIds: ["card-4", "card-5"],
    },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": {
      id: "card-1",
      title: "Align roadmap themes",
      details: "Draft quarterly themes with impact statements and metrics.",
    },
    "card-2": {
      id: "card-2",
      title: "Gather customer signals",
      details: "Review support tags, sales notes, and churn feedback.",
    },
    "card-3": {
      id: "card-3",
      title: "Prototype analytics view",
      details: "Sketch initial dashboard layout and key drill-downs.",
    },
    "card-4": {
      id: "card-4",
      title: "Refine status language",
      details: "Standardize column labels and tone across the board.",
    },
    "card-5": {
      id: "card-5",
      title: "Design card layout",
      details: "Add hierarchy and spacing for scanning dense lists.",
    },
    "card-6": {
      id: "card-6",
      title: "QA micro-interactions",
      details: "Verify hover, focus, and loading states.",
    },
    "card-7": {
      id: "card-7",
      title: "Ship marketing page",
      details: "Final copy approved and asset pack delivered.",
    },
    "card-8": {
      id: "card-8",
      title: "Close onboarding sprint",
      details: "Document release notes and share internally.",
    },
  },
};

async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("password");
  await page.getByRole("button", { name: /sign in/i }).click();
  // The first column renders once the board loads after sign-in.
  await expect(page.locator('[data-testid^="column-"]').first()).toBeVisible();
}

async function resetBoard(request: APIRequestContext) {
  const session = await request.post("/api/auth/login", {
    data: { username: "user", password: "password" },
  });
  expect(session.ok()).toBeTruthy();
  const current = await request.get("/api/kanban");
  expect(current.ok()).toBeTruthy();
  const { version } = await current.json();
  const response = await request.post("/api/kanban", {
    data: { data: DEFAULT_BOARD, version },
  });
  expect(response.ok()).toBeTruthy();
  // Clear chat history so AI context does not leak between tests/runs.
  const clear = await request.delete("/api/chat/history");
  expect(clear.ok()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  await resetBoard(request);
});

test("signs in to see the board", async ({ page }) => {
  await login(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
});

test("adds a card to a column and it persists after reload", async ({
  page,
}) => {
  await login(page);
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add a card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();

  // Reload: the card should still be present because it is persisted server-side.
  await page.reload();
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await login(page);
  const card = page.getByTestId("card-card-1");
  const targetColumn = page.getByTestId("column-col-review");
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    columnBox.x + columnBox.width / 2,
    columnBox.y + 120,
    { steps: 12 }
  );
  await page.mouse.up();
  await expect(targetColumn.getByTestId("card-card-1")).toBeVisible();
});

test("logs out and shows the login form again", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: /log out/i }).click();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
});

test("AI chat can add a card and the board refreshes", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);

  const sidebar = page.getByText("AI Assistant");
  await expect(sidebar).toBeVisible();
  const input = page.getByLabel("Chat message");
  await input.fill(
    "Add a card titled 'Playwright AI Card' to the Backlog column. Reply briefly."
  );
  await page.getByRole("button", { name: /send/i }).click();

  // The AI replies in the sidebar, then applies a boardUpdate that adds the
  // card; the Kanban must show it without a manual reload. The card may land
  // in any column (model variance), so assert on the board card element
  // anywhere (not chat bubbles, which echo the request text).
  await expect(
    page.locator('[data-testid^="card-"]', { hasText: "Playwright AI Card" })
  ).toBeVisible({ timeout: 90_000 });
});
