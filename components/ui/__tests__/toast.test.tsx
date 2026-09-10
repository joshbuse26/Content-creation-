// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "../toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Trigger({ message }: { message: string }) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast(message);
      }}
    >
      boom
    </button>
  );
}

describe("ToastProvider", () => {
  it("shows a toast with role=alert and dismisses on click", () => {
    render(
      <ToastProvider>
        <Trigger message="Save failed" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("boom"));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Save failed");
    fireEvent.click(screen.getByLabelText("Dismiss notification"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("auto-dismisses after the timeout", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger message="Gone soon" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("boom"));
    expect(screen.queryByRole("alert")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("useToast outside the provider throws", () => {
    const orig = console.error;
    console.error = () => undefined;
    expect(() => render(<Trigger message="x" />)).toThrow(/ToastProvider/);
    console.error = orig;
  });
});
