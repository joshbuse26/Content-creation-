// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { StyleGateReport } from "@/lib/types/pipeline";
import { StyleGatesPanel } from "../style-gates-panel";

afterEach(cleanup);

const baseReport: StyleGateReport = {
  hookPatternOk: null,
  ctaPlacementOk: true,
  ctaCount: 1,
  readingGrade: null,
  readingLevelOk: null,
  bannedClaimHits: [],
  bannedClaimsOk: true,
  notes: [],
};

describe("StyleGatesPanel", () => {
  it("renders null sub-fields as 'Not evaluated' — never as a pass", () => {
    render(<StyleGatesPanel report={baseReport} />);
    // hookPatternOk and readingLevelOk are both null (C1 not landed yet).
    expect(screen.getAllByText("Not evaluated")).toHaveLength(2);
    // The two implemented gates pass; the null ones must NOT read as passed.
    expect(screen.getAllByText("Pass")).toHaveLength(2);
  });

  it("renders explicit pass/fail once sub-fields are evaluated", () => {
    render(
      <StyleGatesPanel
        report={{
          ...baseReport,
          hookPatternOk: true,
          readingLevelOk: false,
          readingGrade: 11.2,
        }}
      />,
    );
    expect(screen.queryByText("Not evaluated")).toBeNull();
    expect(screen.getAllByText("Pass")).toHaveLength(3);
    expect(screen.getAllByText("Fail")).toHaveLength(1);
    expect(screen.getByText(/grade 11\.2/)).toBeTruthy();
  });

  it("renders banned-claim failures prominently with the flagged text", () => {
    render(
      <StyleGatesPanel
        report={{
          ...baseReport,
          bannedClaimsOk: false,
          bannedClaimHits: [
            {
              claimType: "guaranteed_results",
              excerpt: "you are guaranteed to double your views",
              sectionHeading: "The payoff",
            },
          ],
        }}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Banned claims found");
    expect(alert.textContent).toContain("you are guaranteed to double your views");
    expect(alert.textContent).toContain("guaranteed results");
    expect(alert.textContent).toContain("The payoff");
  });

  it("shows the CTA count and any notes", () => {
    render(
      <StyleGatesPanel
        report={{ ...baseReport, ctaCount: 3, notes: ["CTA placement rule: after_payoff"] }}
      />,
    );
    expect(screen.getByText(/3 CTAs/)).toBeTruthy();
    expect(screen.getByText("CTA placement rule: after_payoff")).toBeTruthy();
  });
});
