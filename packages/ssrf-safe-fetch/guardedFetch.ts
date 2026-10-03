import dns from 'node:dns';
import net from 'node:net';

import ipaddr from 'ipaddr.js';
import { Agent, buildConnector } from 'undici';

/**
 * Which destinations a guarded fetch may connect to.
 *
 * Defaults are strict: without `allowPrivateIPAddress`, every address whose
 * `ipaddr.js` range is not `unicast` (loopback, private, link-local, CGNAT,
 * unique-local, multicast, reserved, …) is rejected.
 */
export interface SsrfPolicy {
  /** Addresses or CIDR ranges that stay reachable even when private addresses are blocked */
  allowIPAddressList?: string[];
  /** Skip the private / reserved range check entirely */
  allowPrivateIPAddress?: boolean;
}

export const SSRF_BLOCKED_ERROR_CODE = 'SSRF_BLOCKED';

/**
 * Raised when a guarded request would connect to a blocked address. It reaches
 * callers as the `cause` of fetch's `TypeError: fetch failed`; use
 * `findSsrfBlockedError` to recover it from a wrapped SDK error.
 */
export class SsrfBlockedError extends Error {
  readonly code = SSRF_BLOCKED_ERROR_CODE;
  readonly address: string;
  readonly hostname?: string;

  constructor(address: string, hostname?: string) {
    const target = hostname && hostname !== address ? `${hostname} (${address})` : address;
    super(`SSRF blocked: ${target} is a private or reserved address`);
    this.name = 'SsrfBlockedError';
    this.address = address;
    this.hostname = hostname;
  }
}

/** Walk an error's `cause` chain looking for an SSRF block */
export const findSsrfBlockedError = (error: unknown): SsrfBlockedError | undefined => {
  let current: unknown = error;

  for (let depth = 0; current && depth < 8; depth++) {
    if (current instanceof SsrfBlockedError) return current;
    if ((current as { code?: unknown }).code === SSRF_BLOCKED_ERROR_CODE)
      return current as SsrfBlockedError;
    current = (current as { cause?: unknown }).cause;
  }
};

type ParsedAddress = ipaddr.IPv4 | ipaddr.IPv6;

const matchesAddressList = (address: ParsedAddress, list: string[]) =>
  list.some((entry) => {
    try {
      if (entry.includes('/')) {
        const [range, bits] = ipaddr.parseCIDR(entry.trim());
        return range.kind() === address.kind() && address.match(range, bits);
      }

      const parsed = ipaddr.process(entry.trim());
      return (
        parsed.kind() === address.kind() &&
        parsed.toNormalizedString() === address.toNormalizedString()
      );
    } catch {
      return false;
    }
  });

/**
 * Check one resolved address against the policy. Non-IP input is ignored —
 * callers validate what the resolver returned, never the URL string.
 */
export const validateSsrfAddress = (
  address: string,
  policy: SsrfPolicy,
  hostname?: string,
): SsrfBlockedError | undefined => {
  if (net.isIP(address) === 0) return;

  // `process` unwraps IPv4-mapped IPv6 (`::ffff:127.0.0.1`) so it is judged as IPv4
  const parsed = ipaddr.process(address);

  if (policy.allowIPAddressList?.length && matchesAddressList(parsed, policy.allowIPAddressList))
    return;
  if (policy.allowPrivateIPAddress) return;
  if (parsed.range() !== 'unicast') return new SsrfBlockedError(address, hostname);
};

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement that rejects the connection when any resolved
 * address is blocked. Because the socket connects to exactly what this
 * returned, there is no window for DNS rebinding between check and use.
 */
const createGuardedLookup =
  (policy: SsrfPolicy) =>
  (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, options, (error, address, family) => {
      if (error) return callback(error, address, family);

      const resolved = Array.isArray(address) ? address : [{ address, family }];
      for (const entry of resolved) {
        const blocked = validateSsrfAddress(entry.address, policy, hostname);
        if (blocked) return callback(blocked, address, family);
      }

      callback(null, address, family);
    });
  };

const stripBrackets = (hostname: string) => hostname.replaceAll(/^\[|\]$/g, '');

/**
 * An undici dispatcher whose every connection — including each redirect hop —
 * is validated against the policy after DNS resolution and before connecting.
 */
export const createSsrfSafeDispatcher = (policy: SsrfPolicy) => {
  const connector = buildConnector({ lookup: createGuardedLookup(policy) } as any);

  return new Agent({
    connect: (options, callback) => {
      // IP literals never reach `lookup`, so validate them here
      const host = stripBrackets(options.hostname);
      if (net.isIP(host)) {
        const blocked = validateSsrfAddress(host, policy);
        if (blocked) return callback(blocked, null);
      }

      connector(options, callback);
    },
  });
};

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'];

/** Node only routes fetch through `HTTP(S)_PROXY` when `NODE_USE_ENV_PROXY=1` */
const isEnvProxyActive = () =>
  process.env.NODE_USE_ENV_PROXY === '1' && PROXY_ENV_KEYS.some((key) => !!process.env[key]);

const resolveRequestUrl = (input: RequestInfo | URL) =>
  new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/**
 * With an egress proxy the socket goes to the proxy, so connection-time checks
 * would validate the proxy's address instead of the target. Fall back to an
 * application-layer resolution check. This leaves a DNS-rebinding window and
 * does not cover redirects; deployments with a proxy should enforce a
 * private-network ACL on the proxy itself.
 */
const assertResolvedTargetAllowed = async (input: RequestInfo | URL, policy: SsrfPolicy) => {
  const hostname = stripBrackets(resolveRequestUrl(input).hostname);
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.promises.lookup(hostname, { all: true });

  for (const { address } of addresses) {
    const blocked = validateSsrfAddress(address, policy, hostname);
    if (blocked) throw new TypeError('fetch failed', { cause: blocked });
  }
};

export interface CreateSsrfSafeFetchOptions {
  /** The fetch to wrap; defaults to the global fetch at call time */
  fetch?: typeof fetch;
}

/**
 * Build a WHATWG-compatible `fetch` that refuses to connect to private or
 * reserved addresses. Unlike `ssrfSafeFetch`, the response body is streamed
 * untouched, so it can be handed to SDKs (`new OpenAI({ fetch })`) for
 * streaming chat completions.
 */
export const createSsrfSafeFetch = (
  policy: SsrfPolicy = {},
  options: CreateSsrfSafeFetchOptions = {},
): typeof fetch => {
  const getBaseFetch = () => options.fetch ?? globalThis.fetch;

  if (policy.allowPrivateIPAddress)
    return ((input, init) => getBaseFetch()(input, init)) as typeof fetch;

  const dispatcher = createSsrfSafeDispatcher(policy);

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (isEnvProxyActive()) {
      await assertResolvedTargetAllowed(input, policy);
      return getBaseFetch()(input, init);
    }

    return getBaseFetch()(input, { ...init, dispatcher } as RequestInit);
  }) as typeof fetch;
};
