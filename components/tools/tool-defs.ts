import type { FreeToolId } from "@/server/tools/definitions";

/**
 * Free-tool page definitions — pure data shared by the marketing pages
 * (metadata) and the client ToolPage component (form config). Original
 * copy throughout.
 */

export interface ToolField {
  name: string;
  label: string;
  placeholder: string;
  kind: "input" | "textarea";
  required: boolean;
  maxLength: number;
}

export interface ToolDef {
  id: FreeToolId;
  path: string;
  name: string;
  /** Short line for cards and meta descriptions. */
  blurb: string;
  /** Longer lead paragraph on the tool page. */
  lead: string;
  fields: ToolField[];
  submitLabel: string;
  resultHeading: string;
  /** How list results should be copied (joined). */
  copyJoin: string;
}

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    id: "title-generator",
    path: "/tools/title-generator",
    name: "YouTube Title Generator",
    blurb: "Ten click-worthy title options for any video topic — free, no account needed.",
    lead: "Describe your video and get ten titles across curiosity, how-to, list, and contrarian angles. Pick one, or steal the structure and make it yours.",
    fields: [
      {
        name: "topic",
        label: "Video topic",
        placeholder: "e.g. dialing in espresso on a budget grinder",
        kind: "input",
        required: true,
        maxLength: 200,
      },
      {
        name: "audience",
        label: "Audience (optional)",
        placeholder: "e.g. beginner home baristas",
        kind: "input",
        required: false,
        maxLength: 120,
      },
    ],
    submitLabel: "Generate titles",
    resultHeading: "Title options",
    copyJoin: "\n",
  },
  {
    id: "tag-generator",
    path: "/tools/tag-generator",
    name: "YouTube Tag Generator",
    blurb: "15-20 search-ready video tags from a topic — free, copy-paste ready.",
    lead: "Paste your topic and get a balanced tag set: broad discovery tags plus the specific phrases people actually type into search.",
    fields: [
      {
        name: "topic",
        label: "Video topic or title",
        placeholder: "e.g. why your espresso shots taste sour",
        kind: "input",
        required: true,
        maxLength: 300,
      },
    ],
    submitLabel: "Generate tags",
    resultHeading: "Tags",
    copyJoin: ", ",
  },
  {
    id: "description-generator",
    path: "/tools/description-generator",
    name: "YouTube Description Generator",
    blurb: "A clean, structured video description from a two-sentence summary — free.",
    lead: "Summarize the video in a couple of sentences; get back a description with a strong opener, a scannable overview, and a subscribe line — ready for the description box.",
    fields: [
      {
        name: "summary",
        label: "What the video covers",
        placeholder:
          "e.g. I compare three budget espresso grinders on consistency, workflow and taste, and pick the one worth buying.",
        kind: "textarea",
        required: true,
        maxLength: 1200,
      },
    ],
    submitLabel: "Generate description",
    resultHeading: "Description",
    copyJoin: "\n",
  },
  {
    id: "hook-analyzer",
    path: "/tools/hook-analyzer",
    name: "YouTube Hook Analyzer",
    blurb: "Score your video's first 30 seconds and get concrete rewrite suggestions — free.",
    lead: "Paste your opening lines. We score the hook, name the tactic it's using, and suggest the three changes most likely to keep viewers past the intro.",
    fields: [
      {
        name: "hook",
        label: "Your hook (the first ~30 seconds, as text)",
        placeholder:
          "e.g. Everyone says you need a $500 grinder for espresso. I spent a month proving that wrong — and the results surprised me.",
        kind: "textarea",
        required: true,
        maxLength: 1500,
      },
    ],
    submitLabel: "Analyze hook",
    resultHeading: "Analysis",
    copyJoin: "\n",
  },
] as const;

export function toolDef(id: FreeToolId): ToolDef {
  const def = TOOL_DEFS.find((t) => t.id === id);
  if (def === undefined) throw new Error(`unknown tool ${id}`);
  return def;
}
