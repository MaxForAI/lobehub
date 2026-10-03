/**
 * Browser version of SSRF-safe fetch
 * In browser environments, we simply use the native fetch API
 * as SSRF attacks are not applicable in client-side code
 */

/**
 * Options for per-call SSRF configuration overrides
 * (ignored in browser - kept for API parity with server version)
 */
export interface SSRFOptions {
  /** List of IP addresses to allow */
  allowIPAddressList?: string[];
  /** Whether to allow private/local IP addresses */
  allowPrivateIPAddress?: boolean;
  /** Maximum response body size in bytes (server-only; ignored in browser) */
  maxContentLength?: number;
}

/**
 * Browser-safe fetch implementation
 * Uses native fetch API in browser environments
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param _ssrfOptions - Ignored in browser (kept for API parity)
 */
export const ssrfSafeFetch = async (
  url: string,

  options?: RequestInit,

  _ssrfOptions?: SSRFOptions,
): Promise<Response> => {
  return fetch(url, options);
};

export interface SsrfPolicy {
  allowIPAddressList?: string[];
  allowPrivateIPAddress?: boolean;
}

export interface CreateSsrfSafeFetchOptions {
  fetch?: typeof fetch;
}

export const SSRF_BLOCKED_ERROR_CODE = 'SSRF_BLOCKED';

export class SsrfBlockedError extends Error {
  readonly code = SSRF_BLOCKED_ERROR_CODE;
  readonly address: string;
  readonly hostname?: string;

  constructor(address: string, hostname?: string) {
    super(`SSRF blocked: ${hostname ?? address} is a private or reserved address`);
    this.name = 'SsrfBlockedError';
    this.address = address;
    this.hostname = hostname;
  }
}

/** Browser requests are not server-side egress, so nothing is ever blocked */
export const findSsrfBlockedError = (_error: unknown): SsrfBlockedError | undefined => undefined;

export const validateSsrfAddress = (
  _address: string,
  _policy: SsrfPolicy,
  _hostname?: string,
): SsrfBlockedError | undefined => undefined;

export const createSsrfSafeFetch = (
  _policy: SsrfPolicy = {},
  options: CreateSsrfSafeFetchOptions = {},
): typeof fetch => ((input, init) => (options.fetch ?? fetch)(input, init)) as typeof fetch;
