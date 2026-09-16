import type { SVGProps } from "react";

/**
 * Hand-rolled minimal icon set (16×16 grid, stroke-based).
 * lucide-react is requested in REQUESTS-A3.md; these keep the UI unblocked
 * and can be swapped 1:1 once the dependency lands.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3v10M3 8h10" />
    </Svg>
  );
}

export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 9h6.6l.7-9M6.5 7v4M9.5 7v4" />
    </Svg>
  );
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
    </Svg>
  );
}

export function IconLock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Svg>
  );
}

export function IconUnlock(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6.5 8 10l4-3.5" />
    </Svg>
  );
}

export function IconChevronUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 9.5 8 6l4 3.5" />
    </Svg>
  );
}

export function IconArrowUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 13V3M4 7l4-4 4 4" />
    </Svg>
  );
}

export function IconArrowDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3v10M4 9l4 4 4-4" />
    </Svg>
  );
}

export function IconCopy(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m3 8.5 3.5 3.5L13 5" />
    </Svg>
  );
}

export function IconX(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2.5V10M4.5 7 8 10.5 11.5 7M3 13.5h10" />
    </Svg>
  );
}

export function IconSparkle(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2.5 9.4 6l3.6 1.4L9.4 9 8 12.5 6.6 9 3 7.4 6.6 6 8 2.5ZM12.8 11.2l.5 1.3 1.2.5-1.2.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5.5-1.3Z" />
    </Svg>
  );
}

export function IconDoc(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 1.5h5.5L12 4v10.5H4V1.5Z" />
      <path d="M9.5 1.5V4H12M6 7.5h4M6 10h4" />
    </Svg>
  );
}

export function IconLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M6.5 9.5 9.5 6.5M5 11l-1 1a2.47 2.47 0 0 1-3.5-3.5L3 6M11 5l1.5-1.5A2.47 2.47 0 0 1 16 7l-1.5 1.5"
        transform="translate(0 0) scale(0.94)"
      />
    </Svg>
  );
}

export function IconUpload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 10.5V3M4.5 6 8 2.5 11.5 6M3 13.5h10" />
    </Svg>
  );
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </Svg>
  );
}

export function IconPlay(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 3.5v9l7-4.5-7-4.5Z" />
    </Svg>
  );
}

export function IconClock(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2.2 1.3" />
    </Svg>
  );
}

export function IconWarning(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2 14.5 13.5h-13L8 2Z" />
      <path d="M8 6.5v3M8 11.5v.1" />
    </Svg>
  );
}

export function IconPencil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m9.5 3.5 3 3-7 7-3.5.5.5-3.5 7-7ZM8.5 4.5l3 3" />
    </Svg>
  );
}

export function IconGrip(p: IconProps) {
  return (
    <Svg {...p} strokeWidth={0} fill="currentColor">
      <circle cx="6" cy="4" r="1" />
      <circle cx="10" cy="4" r="1" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="10" cy="12" r="1" />
    </Svg>
  );
}

export function IconExpand(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2v12M5 4.5 8 1.5l3 3M5 11.5l3 3 3-3" transform="scale(0.94) translate(0.5 0.5)" />
    </Svg>
  );
}

export function IconCondense(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 1.5v5M5 4 8 7l3-3M8 14.5v-5M5 12l3-3 3 3" />
    </Svg>
  );
}

export function IconHistory(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.8 8a5.2 5.2 0 1 1 1.5 3.7M2.5 8.5 2.8 6l2.3 1M8 5.2v3l2 1.2" />
    </Svg>
  );
}

export function IconChannel(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="2" />
      <path d="M6.8 6v4l3.4-2-3.4-2Z" />
    </Svg>
  );
}

export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 3.5h4.5l1.5 2h7v7.5h-13V3.5Z" />
    </Svg>
  );
}

export function IconGear(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6 11 5M5 11l-1.4 1.4" />
    </Svg>
  );
}

export function IconGoogle(p: IconProps) {
  return (
    <Svg {...p}>
      <path
        d="M14 8.2c0-.5 0-.9-.1-1.4H8v2.6h3.4a3 3 0 0 1-1.3 2v1.6h2.1A6 6 0 0 0 14 8.2Z"
        fill="currentColor"
        stroke="none"
        opacity="0.9"
      />
      <path
        d="M8 14a5.9 5.9 0 0 0 4.2-1.5L10.1 11a3.7 3.7 0 0 1-5.5-2H2.4v1.7A6 6 0 0 0 8 14Z"
        fill="currentColor"
        stroke="none"
        opacity="0.7"
      />
      <path
        d="M4.6 9a3.6 3.6 0 0 1 0-2.3V5H2.4a6 6 0 0 0 0 5.4L4.6 9Z"
        fill="currentColor"
        stroke="none"
        opacity="0.5"
      />
      <path
        d="M8 4.4c.9 0 1.8.3 2.4 1l1.9-1.9A6 6 0 0 0 2.4 5l2.2 1.7A3.6 3.6 0 0 1 8 4.4Z"
        fill="currentColor"
        stroke="none"
        opacity="0.8"
      />
    </Svg>
  );
}

export function IconMail(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="1.5" y="3.5" width="13" height="9" rx="1" />
      <path d="m2 4.5 6 4.5 6-4.5" />
    </Svg>
  );
}

export function IconExternal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 3.5H2.5v10h10V9.5M9.5 2.5h4v4M13 3l-6 6" />
    </Svg>
  );
}

export function IconBulb(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 11.5v-1.2A4.2 4.2 0 0 1 3.8 7a4.2 4.2 0 1 1 8.4 0 4.2 4.2 0 0 1-1.7 3.3v1.2h-5Z" />
      <path d="M6.2 14h3.6" />
    </Svg>
  );
}

export function IconGrid(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </Svg>
  );
}

export function IconPulse(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M1.5 8.5h3l1.5-4 3 7 1.5-3h4" />
    </Svg>
  );
}

export function IconChat(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H7l-3.5 3v-3h-.5A1.5 1.5 0 0 1 1.5 9.5v-6Z" />
    </Svg>
  );
}
