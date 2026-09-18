import type { ComponentType, SVGProps } from "react";
import {
  IconChannel,
  IconFolder,
  IconGear,
  IconGrid,
  IconPulse,
  IconSparkle,
} from "@/components/ui/icons";

/**
 * The app's information architecture — ONE list that drives the left rail,
 * the top-bar breadcrumb and the contextual primary CTA, so a section can't
 * be renamed in one place and not the other.
 *
 * Route notes: "Intel" keeps the `/discover` route (renaming the URL buys
 * nothing and breaks deep links); "Tools" lives at `/toolkit` because
 * `/tools` is the public free-tools marketing route; Ideas is a Tools card,
 * not a section (`/ideas` redirects to `/toolkit`).
 */

export type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

/** The primary action the top bar offers while a section is active. */
export interface SectionCta {
  label: string;
  /** Route to push — or "new-chat" for the Coach's in-context action. */
  action: { kind: "href"; href: string } | { kind: "new-chat" };
}

export interface NavSection {
  href: string;
  label: string;
  icon: NavIcon;
  cta: SectionCta | null;
}

export const APP_NAV: readonly NavSection[] = [
  {
    href: "/coach",
    label: "Coach",
    icon: IconSparkle,
    cta: { label: "New chat", action: { kind: "new-chat" } },
  },
  { href: "/discover", label: "Intel", icon: IconPulse, cta: null },
  {
    href: "/projects",
    label: "Projects",
    icon: IconFolder,
    cta: { label: "New project", action: { kind: "href", href: "/projects?new=1" } },
  },
  {
    href: "/channels",
    label: "Channels",
    icon: IconChannel,
    cta: { label: "Connect channel", action: { kind: "href", href: "/channels#connect" } },
  },
  { href: "/toolkit", label: "Tools", icon: IconGrid, cta: null },
  { href: "/settings", label: "Settings", icon: IconGear, cta: null },
];

/** Where the product starts after sign-in / Enter playtest. */
export const APP_HOME = "/coach";

/** The section that owns a pathname (prefix match), or null outside the IA. */
export function sectionFor(pathname: string): NavSection | null {
  return APP_NAV.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? null;
}
