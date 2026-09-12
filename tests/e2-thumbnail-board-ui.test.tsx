// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { thumbnailConceptSchema, type ThumbnailConcept } from "@/lib/types/entities";
import { FIXTURE_IDS } from "@/lib/fixtures";
import {
  ConceptCard,
  TweakPanel,
  filterConcepts,
  sortConcepts,
  type TweakValues,
} from "@/components/packaging/thumbnail-board";

afterEach(cleanup);

function concept(overrides: Partial<ThumbnailConcept> = {}): ThumbnailConcept {
  const n = overrides.sort ?? 0;
  return thumbnailConceptSchema.parse({
    id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "a")}`,
    workspaceId: FIXTURE_IDS.workspace,
    projectId: FIXTURE_IDS.project,
    promptUsed: "prompt",
    compositionPattern: "big-text",
    imageKey: "thumbnails/x.png",
    status: "candidate",
    boardId: "11111111-1111-4111-8111-111111111111",
    overlayText: "hello",
    presetId: "calm-explainer",
    subjectMode: "face",
    colorMood: "vibrant",
    favorited: false,
    sort: n,
    createdAt: new Date(2026, 0, 1 + n),
    updatedAt: new Date(2026, 0, 1 + n),
    ...overrides,
  });
}

const noop = () => undefined;

describe("board pure helpers", () => {
  it("sortConcepts floats favorites to the front when asked", () => {
    const a = concept({ sort: 0, favorited: false });
    const b = concept({ sort: 1, favorited: true });
    const c = concept({ sort: 2, favorited: false });
    const sorted = sortConcepts([a, b, c], { favoritesFirst: true });
    expect(sorted[0]?.id).toBe(b.id);
    const byOrder = sortConcepts([c, a, b], { favoritesFirst: false });
    expect(byOrder.map((x) => x.sort)).toEqual([0, 1, 2]);
  });

  it("filterConcepts keeps only favorites when favoritesOnly", () => {
    const a = concept({ sort: 0, favorited: false });
    const b = concept({ sort: 1, favorited: true });
    expect(filterConcepts([a, b], { favoritesOnly: true })).toHaveLength(1);
    expect(filterConcepts([a, b], { favoritesOnly: false })).toHaveLength(2);
  });
});

describe("ConceptCard", () => {
  function renderCard(overrides: Partial<ThumbnailConcept> = {}, handlers = {}) {
    const h = {
      onToggleFavorite: vi.fn(),
      onChooseWinner: vi.fn(),
      onOpenTweak: vi.fn(),
      onCloseTweak: vi.fn(),
      onSubmitTweak: vi.fn(),
      onExport: vi.fn(),
      ...handlers,
    };
    render(
      <ConceptCard
        concept={concept(overrides)}
        workspaceId={FIXTURE_IDS.workspace}
        favoriteBusy={false}
        chooseBusy={false}
        tweakBusy={false}
        tweakOpen={false}
        {...h}
      />,
    );
    return h;
  }

  it("renders metadata badges and the overlay text", () => {
    renderCard();
    expect(screen.getByText("big-text")).toBeTruthy();
    expect(screen.getByText("face")).toBeTruthy();
    expect(screen.getByText("vibrant")).toBeTruthy();
    expect(screen.getByText(/hello/)).toBeTruthy();
  });

  it("favorite toggle fires the handler and reflects pressed state", () => {
    const h = renderCard({ favorited: true });
    const star = screen.getByRole("button", { name: /unfavorite concept/i });
    expect(star.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(star);
    expect(h.onToggleFavorite).toHaveBeenCalledOnce();
  });

  it("pick-winner fires for a candidate and is hidden once chosen", () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /pick winner/i }));
    expect(h.onChooseWinner).toHaveBeenCalledOnce();

    cleanup();
    renderCard({ status: "chosen" });
    expect(screen.queryByRole("button", { name: /pick winner/i })).toBeNull();
    expect(screen.getByText(/chosen/)).toBeTruthy();
  });

  it("tweak button opens the panel; export is disabled with no image", () => {
    const h = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /tweak/i }));
    expect(h.onOpenTweak).toHaveBeenCalledOnce();

    cleanup();
    renderCard({ imageKey: null });
    expect(
      screen.getByRole("button", { name: /export concept image/i }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders N cards in a grid", () => {
    render(
      <div>
        {[0, 1, 2, 3].map((n) => (
          <ConceptCard
            key={n}
            concept={concept({ sort: n })}
            workspaceId={FIXTURE_IDS.workspace}
            favoriteBusy={false}
            chooseBusy={false}
            tweakBusy={false}
            tweakOpen={false}
            onToggleFavorite={noop}
            onChooseWinner={noop}
            onOpenTweak={noop}
            onCloseTweak={noop}
            onSubmitTweak={noop}
            onExport={noop}
          />
        ))}
      </div>,
    );
    expect(screen.getAllByTestId("concept-card")).toHaveLength(4);
  });
});

describe("TweakPanel", () => {
  it("submits the edited values (trimmed overlay, changed pattern)", () => {
    const onSubmit = vi.fn<(v: TweakValues) => void>();
    render(<TweakPanel concept={concept()} busy={false} onSubmit={onSubmit} onCancel={noop} />);
    const overlay = screen.getByLabelText(/overlay text/i);
    fireEvent.change(overlay, { target: { value: "  new text  " } });
    const pattern = screen.getByLabelText(/composition pattern/i);
    fireEvent.change(pattern, { target: { value: "countdown" } });
    fireEvent.click(screen.getByRole("button", { name: /regenerate this one/i }));

    expect(onSubmit).toHaveBeenCalledOnce();
    const values = onSubmit.mock.calls[0]?.[0];
    expect(values?.overlayText).toBe("new text");
    expect(values?.compositionPattern).toBe("countdown");
  });

  it("cancel fires the cancel handler", () => {
    const onCancel = vi.fn();
    render(<TweakPanel concept={concept()} busy={false} onSubmit={noop} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
