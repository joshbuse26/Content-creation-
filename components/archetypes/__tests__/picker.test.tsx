// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ARCHETYPE_SEEDS } from "@/lib/archetypes";
import type { GenerationTarget } from "@/lib/types/entities";
import { ArchetypePicker } from "../archetype-picker";

afterEach(cleanup);

function renderPicker(overrides: Partial<Parameters<typeof ArchetypePicker>[0]> = {}) {
  const onChange = vi.fn();
  const utils = render(
    <ArchetypePicker
      archetypes={[...ARCHETYPE_SEEDS]}
      value={null}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { onChange, ...utils };
}

describe("ArchetypePicker — single style", () => {
  it("renders all 12 archetypes as radio options", () => {
    renderPicker();
    const group = screen.getByRole("radiogroup", { name: /pick a style/i });
    expect(group).toBeTruthy();
    for (const a of ARCHETYPE_SEEDS) {
      expect(screen.getByRole("radio", { name: new RegExp(a.displayName, "i") })).toBeTruthy();
    }
  });

  it("selecting an archetype emits an archetype-mode generation target", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByRole("radio", { name: /Calm Explainer/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const target = onChange.mock.calls[0]?.[0] as GenerationTarget;
    expect(target.mode).toBe("archetype");
    expect(target.archetypeId).toBe("calm-explainer");
    expect(target.crossover).toBeNull();
  });

  it("marks the current value as checked", () => {
    renderPicker({
      value: {
        mode: "archetype",
        archetypeId: "hype-gamer",
        crossover: null,
        partnerId: null,
        voiceProfileId: null,
      },
    });
    const selected = screen.getByRole("radio", { name: /Hype Gamer/i });
    expect(selected.getAttribute("aria-checked")).toBe("true");
  });

  it("offers a Channel voice option (emitting null) only when allowNone", () => {
    const { onChange, unmount } = renderPicker({ allowNone: true });
    fireEvent.click(screen.getByRole("radio", { name: /Channel voice/i }));
    expect(onChange).toHaveBeenCalledWith(null);
    unmount();
    renderPicker();
    expect(screen.queryByRole("radio", { name: /Channel voice/i })).toBeNull();
  });

  it("never leaks the TODO(seed-copy) marker into the gallery", () => {
    const { container } = renderPicker();
    expect(container.textContent).not.toContain("TODO(seed-copy)");
  });
});

describe("ArchetypePicker — crossover", () => {
  function openCrossover() {
    const utils = renderPicker();
    fireEvent.click(screen.getByRole("tab", { name: /crossover/i }));
    return utils;
  }

  it("emits a crossover target once two styles are picked", () => {
    const { onChange } = openCrossover();
    const group = screen.getByRole("radiogroup", { name: /pick two styles/i });
    const radios = group.querySelectorAll('[role="radio"]');
    fireEvent.click(radios[0] as Element); // high-stakes-challenge (sort 1)
    expect(onChange).not.toHaveBeenCalled(); // one pick is not a blend yet
    fireEvent.click(radios[1] as Element); // calm-explainer (sort 2)
    expect(onChange).toHaveBeenCalledTimes(1);
    const target = onChange.mock.calls[0]?.[0] as GenerationTarget;
    expect(target.mode).toBe("crossover");
    expect(target.crossover?.a).toBe("high-stakes-challenge");
    expect(target.crossover?.b).toBe("calm-explainer");
    expect(target.crossover?.weightA).toBeCloseTo(0.6);
  });

  it("shows a live blend summary and re-emits when the weight slider moves", () => {
    const { onChange } = openCrossover();
    const group = screen.getByRole("radiogroup", { name: /pick two styles/i });
    const radios = group.querySelectorAll('[role="radio"]');
    fireEvent.click(radios[0] as Element);
    fireEvent.click(radios[1] as Element);
    expect(screen.getByText(/Blend: 60% High-Stakes Challenge/)).toBeTruthy();

    const slider = screen.getByLabelText(/weight/i);
    fireEvent.change(slider, { target: { value: "25" } });
    expect(screen.getByText(/Blend: 25% High-Stakes Challenge/)).toBeTruthy();
    const last = onChange.mock.calls.at(-1)?.[0] as GenerationTarget;
    expect(last.crossover?.weightA).toBeCloseTo(0.25);
  });

  it("clicking a picked style deselects it", () => {
    const { onChange } = openCrossover();
    const group = screen.getByRole("radiogroup", { name: /pick two styles/i });
    const radios = group.querySelectorAll('[role="radio"]');
    fireEvent.click(radios[0] as Element);
    fireEvent.click(radios[0] as Element); // toggle off
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/pick the base style/i)).toBeTruthy();
  });
});

describe("ArchetypePicker — gated modes", () => {
  it("renders no partnered tab while the build flag is off", () => {
    renderPicker();
    expect(screen.queryByRole("tab", { name: /partnered/i })).toBeNull();
  });

  it("never mentions train_on_my_channel anywhere (v1)", () => {
    const { container } = renderPicker();
    expect(container.textContent.toLowerCase()).not.toContain("train on my channel");
  });
});
