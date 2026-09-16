// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "@/app/(marketing)/page";
import { PRODUCT_NAME } from "@/lib/branding";
import { APP_HOME } from "@/components/shell/nav";

// Updated by A3 when the placeholder home page became the marketing landing
// page (app/(marketing)/page.tsx). Intent preserved: branding renders from
// the single PRODUCT_NAME constant, never hardcoded.

describe("LandingPage", () => {
  it("renders hero, features, CTA, and the product name from the branding constant", () => {
    const { container } = render(createElement(LandingPage));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getAllByText(new RegExp(PRODUCT_NAME)).length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="marketing-hero"]')?.textContent).toMatch(
      /Pick a style/i,
    );
    expect(container.querySelector('[data-testid="marketing-features"]')?.textContent).toMatch(
      /Styles, not templates/,
    );
    expect(container.querySelector('[data-testid="marketing-cta"]')?.textContent).toMatch(
      /Your next video/i,
    );
    const cta = screen
      .getAllByRole("link")
      .find((el) => /Enter the app|Write your first script free|Start free/i.test(el.textContent));
    expect(cta).toBeTruthy();
    // F1: the product's home is the Coach (APP_HOME); signed-out goes to /login.
    expect([APP_HOME, "/login"]).toContain(cta?.getAttribute("href"));
  });
});
