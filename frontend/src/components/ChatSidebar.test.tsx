import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ChatSidebar } from "@/components/ChatSidebar";
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

describe("ChatSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getChatHistory.mockResolvedValue({ messages: [] });
  });

  it("renders restored history from the backend", async () => {
    api.getChatHistory.mockResolvedValue({
      messages: [
        { role: "user", content: "Add a card" },
        { role: "assistant", content: "Done" },
      ],
    });
    render(<ChatSidebar />);
    expect(await screen.findByText("Add a card")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("sends a message and shows the assistant reply", async () => {
    api.chat.mockResolvedValue({
      reply: "Added it.",
      boardUpdate: null,
      version: 1,
    });
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.type(
      await screen.findByLabelText("Chat message"),
      "Add a card"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText("Added it.")).toBeInTheDocument();
    expect(screen.getByText("Add a card")).toBeInTheDocument();
    expect(api.chat).toHaveBeenCalledWith("Add a card");
  });

  it("calls onBoardUpdate when the AI returns a board update", async () => {
    const update = {
      columns: [
        { id: "col-a", title: "Backlog", cardIds: ["card-1", "card-9"] },
      ],
      cards: {
        "card-1": { id: "card-1", title: "Task", details: "Details" },
        "card-9": { id: "card-9", title: "AI card", details: "" },
      },
    };
    api.chat.mockResolvedValue({
      reply: "Added card-9.",
      boardUpdate: update,
      version: 2,
    });
    const onBoardUpdate = vi.fn();
    const user = userEvent.setup();
    render(<ChatSidebar onBoardUpdate={onBoardUpdate} />);

    await user.type(
      await screen.findByLabelText("Chat message"),
      "Add a card"
    );
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() =>
      expect(onBoardUpdate).toHaveBeenCalledWith(update, 2)
    );
  });

  it("does not call onBoardUpdate when boardUpdate is null", async () => {
    api.chat.mockResolvedValue({ reply: "Hi", boardUpdate: null, version: 1 });
    const onBoardUpdate = vi.fn();
    const user = userEvent.setup();
    render(<ChatSidebar onBoardUpdate={onBoardUpdate} />);

    await user.type(await screen.findByLabelText("Chat message"), "Hello");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await screen.findByText("Hi");
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("shows an error when the chat request fails", async () => {
    api.chat.mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.type(await screen.findByLabelText("Chat message"), "Hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The AI could not respond"
    );
  });

  it("calls onUnauthorized on a 401 response", async () => {
    api.chat.mockRejectedValue(
      new apiModule.ApiError(401, "Not authenticated")
    );
    const onUnauthorized = vi.fn();
    const user = userEvent.setup();
    render(<ChatSidebar onUnauthorized={onUnauthorized} />);

    await user.type(await screen.findByLabelText("Chat message"), "Hi");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalled());
  });
});
