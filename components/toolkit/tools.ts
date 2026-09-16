/**
 * The Tools landing (F1 stub for the F4 grid): every card opens a REAL
 * surface that exists today — never a chat questionnaire. Cards whose home
 * is a project stage point at /projects until F4/F5 give them a route.
 */
export interface ToolkitTool {
  slug: string;
  title: string;
  blurb: string;
  href: string;
  /** Where the tool lives today, shown as a small hint on the card. */
  opens: string;
}

export const TOOLKIT_TOOLS: readonly ToolkitTool[] = [
  {
    slug: "hooks",
    title: "Hook Generator",
    blurb: "Five openers in your style for any topic.",
    href: "/coach",
    opens: "Coach",
  },
  {
    slug: "titles",
    title: "Title Generator",
    blurb: "Click-worthy titles scored for curiosity and clarity.",
    href: "/tools/title-generator",
    opens: "Title tool",
  },
  {
    slug: "thumbnails",
    title: "Thumbnail Studio",
    blurb: "Preset-driven thumbnail concepts and image boards.",
    href: "/projects",
    opens: "Project → Packaging",
  },
  {
    slug: "research",
    title: "Research",
    blurb: "Sources, facts and citations that survive into the script.",
    href: "/projects",
    opens: "Project → Research",
  },
  {
    slug: "train-voice",
    title: "Train voice",
    blurb: "Derive a StyleCard from your own channel's videos.",
    href: "/projects",
    opens: "Project → Style",
  },
  {
    slug: "intel",
    title: "Outlier Intel",
    blurb: "Videos beating their channel's baseline, by niche.",
    href: "/discover",
    opens: "Intel",
  },
  {
    slug: "script",
    title: "Outline / Script",
    blurb: "Topics → outline → hooks → full draft, staged and metered.",
    href: "/projects",
    opens: "Project → Generate",
  },
  {
    slug: "metadata",
    title: "Description / Tags",
    blurb: "Descriptions, tags and chapters for the upload form.",
    href: "/tools/description-generator",
    opens: "Description tool",
  },
];
