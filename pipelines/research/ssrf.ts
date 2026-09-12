import { lookup as dnsLookup } from "node:dns/promises";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

/**
 * SSRF guard for the research fetcher (build spec §9): the server fetches
 * arbitrary URLs returned by web search, so every request is confined to
 * public hosts:
 * - http/https only, default ports semantics left to fetch
 * - hostname resolved first; EVERY resolved address must be public
 * - the connection is PINNED to the vetted address: the actual fetch uses a
 *   dispatcher whose connect() lookup returns the pre-validated IP, so a
 *   DNS-rebinding TOCTOU (guard resolves A, fetch re-resolves B) is
 *   impossible. TLS SNI/verification still use the original hostname.
 * - redirects followed manually (max 5), vetted AND pinned hop by hop
 * - 10s total timeout, 500KB response cap
 */

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 500 * 1024;
export const MAX_REDIRECTS = 5;

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 doc
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51) return true; // 198.51.100/24 doc
  if (a === 203 && b === 0) return true; // 203.0.113/24 doc
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) {
    // IPv6
    if (normalized === "::" || normalized === "::1") return true;
    // IPv4-mapped / translated (::ffff:a.b.c.d, 64:ff9b::a.b.c.d)
    const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
    if (v4?.[1] !== undefined) return isPrivateIpv4(v4[1]);
    const head = normalized.split(":")[0] ?? "";
    if (head === "") return true; // starts with :: — loopback/unspecified space
    const firstHextet = parseInt(head, 16);
    if (Number.isNaN(firstHextet)) return true;
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (firstHextet === 0x64 && normalized.startsWith("64:ff9b")) return true; // NAT64
    return false;
  }
  return isPrivateIpv4(normalized);
}

const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]*:[0-9a-f:.]*\]?$/i;

export type DnsLookupFn = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: DnsLookupFn = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address }));
};

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/**
 * Thrown when a fetch exceeds its deadline. Distinct from SsrfBlockedError so
 * the research pipeline can log "slow source skipped" vs. "blocked source
 * skipped"; both are non-fatal and the run continues.
 */
export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

/**
 * Vets a URL (throws SsrfBlockedError unless it points at a public host)
 * and returns the validated address the connection must be pinned to.
 * The hostname is resolved EXACTLY ONCE — the returned address is what
 * guardedFetch actually connects to.
 */
export async function vetUrl(
  rawUrl: string,
  lookup: DnsLookupFn = defaultLookup,
): Promise<{ url: URL; address: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfBlockedError(`blocked protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new SsrfBlockedError(`blocked host: ${host}`);
  }
  if (IP_LITERAL.test(host)) {
    const literal = host.replace(/^\[|\]$/g, "");
    if (isPrivateIp(literal)) throw new SsrfBlockedError(`blocked private address: ${host}`);
    return { url, address: literal };
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new SsrfBlockedError(`DNS resolution failed for ${host}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`DNS returned no addresses for ${host}`);
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(`blocked: ${host} resolves to private address ${address}`);
    }
  }
  const first = addresses[0];
  if (first === undefined) throw new SsrfBlockedError(`DNS returned no addresses for ${host}`);
  return { url, address: first.address };
}

/** Throws SsrfBlockedError unless the URL points at a public host. */
export async function assertPublicUrl(
  rawUrl: string,
  lookup: DnsLookupFn = defaultLookup,
): Promise<URL> {
  const { url } = await vetUrl(rawUrl, lookup);
  return url;
}

/**
 * fetch-compatible callable that additionally receives the pinned
 * dispatcher (undici Agent) for the hop. The global-fetch signature is a
 * structural subset, so tests can keep injecting a plain fake fetch.
 */
export type GuardedFetchImpl = (
  url: string,
  init: RequestInit & { dispatcher?: Dispatcher },
) => Promise<Response>;

export interface PinnedConnection {
  dispatcher: Dispatcher | undefined;
  close(): Promise<void> | void;
}

/**
 * Default pinning: an undici Agent whose connector resolves the hostname to
 * the pre-validated address — TLS servername/cert checks still run against
 * the real hostname, only the socket target is fixed.
 */
export function createPinnedDispatcher(_hostname: string, address: string): PinnedConnection {
  const family = address.includes(":") ? 6 : 4;
  const lookup = (
    _host: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ) => {
    if (options.all === true) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
  // Cast: undici forwards connect options (including `lookup`) to
  // net/tls connect; its typings only enumerate the common subset.
  const agent = new Agent({ connect: { lookup } as Agent.Options["connect"] });
  return { dispatcher: agent, close: () => agent.close() };
}

export interface GuardedFetchOptions {
  lookup?: DnsLookupFn;
  fetchImpl?: GuardedFetchImpl;
  /** Seam for tests: how a vetted (hostname, address) pair becomes the
   *  connection the fetch uses. Defaults to the pinned undici Agent. */
  createDispatcher?: (hostname: string, address: string) => PinnedConnection;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FetchedPage {
  finalUrl: string;
  status: number;
  /** Raw body, capped at maxBytes. */
  body: string;
}

const defaultFetchImpl: GuardedFetchImpl = (url, init) =>
  undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;

/**
 * Fetch with the SSRF guard applied to the initial URL and EVERY redirect
 * hop, a hard timeout, and a byte cap enforced while streaming. Each hop
 * resolves DNS exactly once (vetUrl) and connects to that vetted address
 * via a pinned dispatcher, closing the DNS-rebinding TOCTOU window.
 *
 * The timeout is enforced two ways so a slow or hostile source can NEVER
 * hang the research pipeline: the AbortSignal aborts a well-behaved fetch,
 * AND the whole operation races a hard deadline that rejects with a
 * {@link FetchTimeoutError} even if the underlying fetch ignores the signal
 * (or a body read stalls). The pipeline treats that as a skipped source.
 */
export async function guardedFetch(
  rawUrl: string,
  options: GuardedFetchOptions = {},
): Promise<FetchedPage> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(() => {
      controller.abort();
      reject(new FetchTimeoutError(`fetch exceeded ${timeoutMs}ms: ${rawUrl}`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([runGuardedFetch(rawUrl, controller, options), deadline]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
  }
}

async function runGuardedFetch(
  rawUrl: string,
  controller: AbortController,
  options: GuardedFetchOptions,
): Promise<FetchedPage> {
  const lookup = options.lookup ?? defaultLookup;
  const fetchImpl = options.fetchImpl ?? defaultFetchImpl;
  const createDispatcher = options.createDispatcher ?? createPinnedDispatcher;
  const maxBytes = options.maxBytes ?? FETCH_MAX_BYTES;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { url, address } = await vetUrl(current, lookup);
    const pinned = createDispatcher(url.hostname, address);
    try {
      const response = await fetchImpl(url.toString(), {
        redirect: "manual",
        signal: controller.signal,
        dispatcher: pinned.dispatcher,
        headers: {
          "user-agent": "GinRummyResearch/1.0 (+research-agent)",
          accept: "text/html,text/plain,*/*",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) throw new Error(`redirect without location from ${current}`);
        current = new URL(location, url).toString();
        // Body of a redirect response is irrelevant; loop re-vets and
        // re-pins the next hop.
        continue;
      }
      const reader = response.body?.getReader();
      if (reader === undefined) {
        return { finalUrl: url.toString(), status: response.status, body: "" };
      }
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let text = "";
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          text += decoder.decode(value.subarray(0, value.byteLength - (bytes - maxBytes)));
          await reader.cancel();
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
      return { finalUrl: url.toString(), status: response.status, body: text };
    } finally {
      await pinned.close();
    }
  }
  throw new Error(`too many redirects fetching ${rawUrl}`);
}

/** Strip an HTML page to readable text; returns { title, text }. */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  return { title: title === "" ? null : title, text: stripped };
}
