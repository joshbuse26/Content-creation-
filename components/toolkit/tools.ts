import { coachLaunchHref } from "@/components/chat/coach-launch";

/**
 * The Tools landing: every card opens a REAL surface — never a chat
 * questionnaire. Writing tools open the Coach with the job already in the
 * composer (one conversation per launch); Thumbnail Studio and Intel are
 * their own screens.
 */
export interface ToolkitTool {
  slug: string;
  title: string;
  blurb: string;
  href: string;
  /** Where the tool runs, shown as a small hint on the card. */
  opens: string;
}

const COACH = "Coach";

export const TOOLKIT_TOOLS: readonly ToolkitTool[] = [
  {
    slug: "hooks",
    title: "Hook Generator",
    blurb: "Five openers in your style for any topic.",
    href: coachLaunchHref("Give me 5 hooks for a video about: "),
    opens: COACH,
  },
  {
    slug: "titles",
    title: "Title Generator",
    blurb: "Click-worthy titles scored for curiosity and clarity.",
    href: coachLaunchHref("Give me 10 title options for a video about: "),
    opens: COACH,
  },
  {
    slug: "thumbnails",
    title: "Thumbnail Studio",
    blurb: "Real 1280×720 thumbnails — star the keepers, export the winner.",
    href: "/toolkit/thumbnails",
    opens: "Studio",
  },
  {
    slug: "ideas",
    title: "Ideas",
    blurb: "Concepts mined from your niche's outliers, with live demand.",
    href: "/toolkit/ideas",
    opens: "Ideas",
  },
  {
    slug: "research",
    title: "Research",
    blurb: "Sources, facts and citations that survive into the script.",
    href: coachLaunchHref("Research this topic and give me the key facts with sources: "),
    opens: COACH,
  },
  {
    slug: "outline",
    title: "Outline / Script",
    blurb: "Topics → outline → hooks → full draft, in your style.",
    href: coachLaunchHref("Outline a 10-minute video about: "),
    opens: COACH,
  },
  {
    slug: "metadata",
    title: "Description / Tags",
    blurb: "Descriptions, tags and chapters for the upload form.",
    href: coachLaunchHref("Write the YouTube description, tags and chapters for a video about: "),
    opens: COACH,
  },
  {
    slug: "intel",
    title: "My channel stats",
    blurb: "Your uploads, subscribers and what's working — in plain English.",
    href: "/discover",
    opens: "Intel",
  },
];
