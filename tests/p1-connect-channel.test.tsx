// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FIXTURE_IDS } from "@/lib/fixtures";
import { asWorkspaceId } from "@/lib/types/ids";

/**
 * P1 regression — channel connect UX.
 *
 *  1. Pasting a public @handle / URL is the PRIMARY call-to-action.
 *  2. Google OAuth ("verify ownership") is secondary, and when it is not
 *     configured the user sees a friendly inline note — NEVER the raw JSON
 *     error the start route returns.
 */

// Mock the data/context providers so ConnectChannel can render standalone.
const selectChannel = vi.fn();
const connectMutate = vi.fn();
let mockWorkspaceId: ReturnType<typeof asWorkspaceId> | null = asWorkspaceId(FIXTURE_IDS.workspace);

vi.mock("@/components/providers/workspace-context", () => ({
  useWorkspace: () => ({ workspaceId: mockWorkspaceId, selectChannel }),
}));

vi.mock("@/components/providers/trpc", () => ({
  trpc: {
    useUtils: () => ({ channel: { list: { invalidate: vi.fn() } } }),
    channel: {
      connectPublic: {
        useMutation: () => ({ mutate: connectMutate, isPending: false, isError: false }),
      },
    },
  },
}));

import {
  ConnectChannel,
  OwnershipVerifyCard,
  isGoogleOauthConfigured,
} from "@/components/channels/connect-channel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("isGoogleOauthConfigured", () => {
  const original = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;
  afterEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = original;
  });

  it("is false when the flag is unset (playtest default)", () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;
    expect(isGoogleOauthConfigured()).toBe(false);
  });

  it("is true only when the flag is explicitly enabled", () => {
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = "1";
    expect(isGoogleOauthConfigured()).toBe(true);
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = "false";
    expect(isGoogleOauthConfigured()).toBe(false);
  });
});

describe("OwnershipVerifyCard (secondary OAuth option)", () => {
  it("shows a friendly not-configured note — never a raw error — when OAuth is unavailable", () => {
    render(<OwnershipVerifyCard configured={false} workspaceId={mockWorkspaceId} />);
    expect(screen.getByText(/isn.t set up yet/i)).toBeTruthy();
    // No affordance that would navigate to the JSON start route.
    expect(screen.queryByRole("button", { name: /verify with google/i })).toBeNull();
  });

  it("offers the verify action when OAuth is configured", () => {
    render(<OwnershipVerifyCard configured workspaceId={mockWorkspaceId} />);
    expect(screen.getByRole("button", { name: /verify with google/i })).toBeTruthy();
    expect(screen.queryByText(/isn.t set up yet/i)).toBeNull();
  });
});

describe("ConnectChannel layout", () => {
  beforeEach(() => {
    mockWorkspaceId = asWorkspaceId(FIXTURE_IDS.workspace);
    delete process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;
  });

  it("renders public paste as the primary call-to-action", () => {
    render(<ConnectChannel />);
    // The public paste input + primary Connect button are present.
    expect(screen.getByLabelText(/channel url or handle/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /connect channel/i })).toBeTruthy();
  });

  it("keeps OAuth secondary and shows the friendly note when not configured", () => {
    render(<ConnectChannel />);
    expect(screen.getByText(/isn.t set up yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify with google/i })).toBeNull();
  });

  it("orders the public connect card before the ownership option", () => {
    const { container } = render(<ConnectChannel />);
    const html = container.innerHTML;
    expect(html.indexOf("Connect a channel")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Connect a channel")).toBeLessThan(html.indexOf("Verify ownership"));
  });
});
