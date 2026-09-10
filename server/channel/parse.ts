/**
 * Public-URL channel connect (build spec §5.1): parse whatever the user
 * pastes — a channel URL, a @handle, a bare handle, or a raw UC… channel id —
 * into a normalized reference we can hand to YoutubeProvider.getChannel().
 *
 * A1-owned (server/channel/**).
 */

export interface ChannelRef {
  kind: "id" | "handle";
  /** A UC… channel id, or an @-prefixed handle. */
  value: string;
}

export class InvalidChannelRefError extends Error {
  constructor(input: string) {
    super(`Could not parse a YouTube channel from "${input}"`);
    this.name = "InvalidChannelRefError";
  }
}

/** UC + URL-safe base64 chars — canonically 22, ranged for test/fixture ids. */
const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{20,32}$/;
/** YouTube handle: 3–30 chars, letters/digits/._- (per YouTube's handle rules). */
const HANDLE_RE = /^[A-Za-z0-9._-]{3,30}$/;

function asHandle(raw: string): ChannelRef | null {
  const value = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!HANDLE_RE.test(value)) return null;
  return { kind: "handle", value: `@${value}` };
}

function fromPath(pathname: string): ChannelRef | null {
  const segments = pathname.split("/").filter((s) => s.length > 0);
  const first = segments[0];
  if (first === undefined) return null;

  if (first === "channel") {
    const id = segments[1];
    if (id !== undefined && CHANNEL_ID_RE.test(id)) return { kind: "id", value: id };
    return null;
  }
  if (first.startsWith("@")) {
    return asHandle(first);
  }
  // Legacy /c/<name> and /user/<name> custom URLs — best-effort handle lookup.
  if (first === "c" || first === "user") {
    const name = segments[1];
    if (name !== undefined) return asHandle(name);
    return null;
  }
  return null;
}

/**
 * Parse a user-supplied channel reference. Accepts:
 *  - `UCxxxxxxxxxxxxxxxxxxxxxx` (raw channel id)
 *  - `@somehandle` / `somehandle`
 *  - `https://www.youtube.com/channel/UC…`
 *  - `https://youtube.com/@somehandle`
 *  - `youtube.com/c/SomeName`, `youtube.com/user/SomeName`
 *
 * @throws InvalidChannelRefError when nothing channel-shaped can be found.
 */
export function parseChannelRef(input: string): ChannelRef {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new InvalidChannelRefError(input);

  if (CHANNEL_ID_RE.test(trimmed)) return { kind: "id", value: trimmed };

  if (trimmed.includes("/") || trimmed.includes("youtube.")) {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      throw new InvalidChannelRefError(input);
    }
    const host = url.hostname.toLowerCase();
    const isYoutubeHost =
      host === "youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "youtu.be" ||
      host === "yt.be";
    if (!isYoutubeHost) throw new InvalidChannelRefError(input);
    const ref = fromPath(url.pathname);
    if (ref === null) throw new InvalidChannelRefError(input);
    return ref;
  }

  const handle = asHandle(trimmed);
  if (handle === null) throw new InvalidChannelRefError(input);
  return handle;
}
