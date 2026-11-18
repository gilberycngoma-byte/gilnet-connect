import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusNotice } from "@/components/gpm/SyncStatusNotice";

describe("sync status notice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses the sign-in-required notice after five seconds", () => {
    const onSignIn = vi.fn();
    render(<SyncStatusNotice onSignIn={onSignIn} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cloud sync is paused until you sign in again.",
    );
    act(() => vi.advanceTimersByTime(4999));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Sync paused");
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
