// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/page";
import { PRODUCT_NAME } from "@/lib/branding";

describe("HomePage", () => {
  it("renders the product name from the single branding constant", () => {
    render(createElement(HomePage));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(PRODUCT_NAME);
  });
});
