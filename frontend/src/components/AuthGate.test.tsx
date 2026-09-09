import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AuthGate } from "@/components/AuthGate";
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
    columns: [{ id: "col-a", title: "Backlog", cardIds: ["card-1"] }],
    cards: { "card-1": { id: "card-1", title: "Task", details: "Details" } },
  },
};

describe("AuthGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getBoard.mockResolvedValue(sampleBoard);
    api.getChatHistory.mockResolvedValue({ messages: [] });
  });

  it("shows login form when unauthenticated", async () => {
    api.me.mockRejectedValue(new apiModule.ApiError(401, "Not authenticated"));
    render(<AuthGate />);

    expect(await screen.findByTestId("login-form")).toBeInTheDocument();
  });

  it("renders the board when authenticated", async () => {
    api.me.mockResolvedValue({ username: "user" });
    render(<AuthGate />);

    await screen.findByRole("heading", { name: "Kanban Studio" });
    expect(api.me).toHaveBeenCalled();
    expect(api.getBoard).toHaveBeenCalled();
  });

  it("logs in with credentials and shows the board", async () => {
    api.me.mockRejectedValue(new apiModule.ApiError(401, "Not authenticated"));
    api.login.mockResolvedValue({ username: "user" });
    render(<AuthGate />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(api.login).toHaveBeenCalledWith("user", "password")
    );
    expect(
      await screen.findByRole("heading", { name: "Kanban Studio" })
    ).toBeInTheDocument();
  });

  it("shows an error message on failed login", async () => {
    api.me.mockRejectedValue(new apiModule.ApiError(401, "Not authenticated"));
    api.login.mockRejectedValue(new apiModule.ApiError(401, "Invalid credentials"));
    render(<AuthGate />);

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "user");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("alert")
    ).toHaveTextContent("Invalid credentials");
  });

  it("logs out and returns to the login form", async () => {
    api.me.mockResolvedValue({ username: "user" });
    api.logout.mockResolvedValue({ status: "ok" });
    render(<AuthGate />);

    await screen.findByRole("heading", { name: "Kanban Studio" });
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));

    expect(await screen.findByTestId("login-form")).toBeInTheDocument();
  });
});
