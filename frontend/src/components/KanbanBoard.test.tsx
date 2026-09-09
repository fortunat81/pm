import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { KanbanBoard } from "@/components/KanbanBoard";
import * as apiModule from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>();
  return {
    ...actual,
    api: {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      getBoard: vi.fn(),
      saveBoard: vi.fn(),
      chat: vi.fn(),
      getChatHistory: vi.fn(),
    },
  };
});

const api = vi.mocked(apiModule.api);

const sampleBoard: apiModule.BoardResponse = {
  title: "My Board",
  version: 1,
  data: {
    columns: [
      { id: "col-a", title: "Backlog", cardIds: ["card-1", "card-2"] },
      { id: "col-b", title: "Done", cardIds: [] },
    ],
    cards: {
      "card-1": { id: "card-1", title: "Task one", details: "Details one" },
      "card-2": { id: "card-2", title: "Task two", details: "Details two" },
    },
  },
};

describe("KanbanBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getBoard.mockResolvedValue(sampleBoard);
    api.saveBoard.mockImplementation(async (data, version) => ({
      title: "My Board",
      data,
      version: version + 1,
    }));
    api.getChatHistory.mockResolvedValue({ messages: [] });
  });

  it("loads and renders columns from the API", async () => {
    render(<KanbanBoard />);
    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(2);
    expect(api.getBoard).toHaveBeenCalled();
  });

  it("renames a column and persists", async () => {
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-a");
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");

    await waitFor(() => expect(api.saveBoard).toHaveBeenCalled(), {
      timeout: 2000,
    });
    const saved = api.saveBoard.mock.calls.at(-1)![0];
    const renamed = saved.columns.find((c) => c.id === "col-a");
    expect(renamed?.title).toBe("New Name");
  });

  it("adds a card and persists", async () => {
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-b");
    await userEvent.click(
      within(column).getByRole("button", { name: /add a card/i })
    );
    await userEvent.type(
      within(column).getByPlaceholderText(/card title/i),
      "New card"
    );
    await userEvent.type(
      within(column).getByPlaceholderText(/details/i),
      "Notes"
    );
    await userEvent.click(
      within(column).getByRole("button", { name: /add card/i })
    );

    await waitFor(() => expect(api.saveBoard).toHaveBeenCalled());
    const afterAdd = api.saveBoard.mock.calls.at(-1)![0];
    const addedCardId = afterAdd.columns.find((c) => c.id === "col-b")
      ?.cardIds[0];
    expect(addedCardId).toBeTruthy();
    expect(afterAdd.cards[addedCardId!]?.title).toBe("New card");
  });

  it("redirects to login on 401 when loading", async () => {
    api.getBoard.mockRejectedValue(
      new apiModule.ApiError(401, "Not authenticated")
    );
    const onUnauthorized = vi.fn();
    render(<KanbanBoard onUnauthorized={onUnauthorized} />);
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });

  it("shows an error banner when saving fails", async () => {
    api.saveBoard.mockRejectedValue(new Error("boom"));
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-a");
    const input = within(column).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Broken");

    expect(
      await screen.findByRole("alert", {}, { timeout: 2000 })
    ).toHaveTextContent("Could not save changes");
  });

  it("deletes a card and persists", async () => {
    render(<KanbanBoard />);
    const column = await screen.findByTestId("column-col-a");
    await userEvent.click(
      within(column).getByRole("button", { name: /delete task one/i })
    );

    await waitFor(() => expect(api.saveBoard).toHaveBeenCalled());
    const saved = api.saveBoard.mock.calls.at(-1)![0];
    expect(saved.cards["card-1"]).toBeUndefined();
    const columnA = saved.columns.find((c) => c.id === "col-a");
    expect(columnA?.cardIds).not.toContain("card-1");
    expect(screen.queryByText("Task one")).not.toBeInTheDocument();
  });

  it("renders the AI chat sidebar", async () => {
    render(<KanbanBoard />);
    expect(
      await screen.findByRole("heading", { name: "AI Assistant" })
    ).toBeInTheDocument();
    await waitFor(() => expect(api.getChatHistory).toHaveBeenCalled());
  });

  it("replaces the board when the AI returns a board update", async () => {
    const updated = {
      ...sampleBoard.data,
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1", "card-9"] },
        { id: "col-b", title: "Done", cardIds: [] },
      ],
      cards: {
        ...sampleBoard.data.cards,
        "card-9": { id: "card-9", title: "AI card", details: "" },
      },
    };
    api.chat.mockResolvedValue({
      reply: "Added card-9.",
      boardUpdate: updated,
      version: 2,
    });

    render(<KanbanBoard />);
    const messageInput = await screen.findByLabelText("Chat message");
    await userEvent.type(messageInput, "Add a card");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("AI card")).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledWith("Add a card");
  });
});
