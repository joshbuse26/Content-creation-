// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "@/app/(marketing)/page";
import { PRODUCT_NAME } from "@/lib/branding";

// Updated by A3 when the placeholder home page became the marketing landing
// page (app/(marketing)/page.tsx). Intent preserved: branding renders from
// the single PRODUCT_NAME constant, never hardcoded.

describe("LandingPage", () => {
  it("renders a headline and the product name from the branding constant", () => {
    render(createElement(LandingPage));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getAllByText(new RegExp(PRODUCT_NAME)).length).toBeGreaterThan(0);
  });
});
