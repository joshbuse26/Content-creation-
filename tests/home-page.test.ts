// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import LandingPage from "@/app/(marketing)/page";
import { PRODUCT_NAME } from "@/lib/branding";
import { APP_HOME } from "@/components/shell/nav";

// Updated by A3 when the placeholder home page became the marketing landing
// page (app/(marketing)/page.tsx). Intent preserved: branding renders from
// the single PRODUCT_NAME constant, never hardcoded.

describe("LandingPage", () => {
  it("is a short hero + the eight named core features + one CTA — no steps, pricing or archetype walls", () => {
    const { container } = render(createElement(LandingPage));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PRODUCT_NAME);
    expect(container.querySelector('[data-testid="marketing-hero"]')?.textContent).toMatch(
      /script and packaging coach/i,
    );

    const features = screen.getByRole("list", { name: "Core features" });
    const items = within(features).getAllByRole("listitem");
    expect(items.map((li) => li.textContent.split(" — ")[0])).toEqual([
      "Coach",
      "Intel",
      "Ideas",
      "Scripts",
      "Styles",
      "Packaging",
      "Thumbnail Studio",
      "Channels",
    ]);
    // Name + at most eight words each.
    for (const li of items) {
      const line = li.textContent.split(" — ")[1] ?? "";
      expect(line.trim().split(/\s+/).length).toBeLessThanOrEqual(8);
    }

    const text = container.textContent;
    expect(text).not.toMatch(/pricing|per month|credit|\$\d/i);
    expect(text).not.toMatch(/how it works|twelve styles|0[1-4]\b/i);
    expect(text).not.toMatch(/grok|xai/i);

    const cta = screen
      .getAllByRole("link")
      .find((el) => /Enter the app|Sign in/i.test(el.textContent));
    expect(cta).toBeTruthy();
    // The product's home is the Coach (APP_HOME); signed-out goes to /login.
    expect([APP_HOME, "/login"]).toContain(cta?.getAttribute("href"));
  });
});
