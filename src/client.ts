/**
 * Minimal fetch-based client for the AIEOS public API.
 * All methods call the public HTTPS endpoints — zero internal server code.
 */

export interface RegisterPayload {
  standard: { protocol: string; version: string; schema_url?: string };
  metadata: { public_key: string; signature: string; alias?: string };
  identity: { names: string[]; [key: string]: unknown };
  capabilities?: Record<string, unknown>;
  endpoints?: Record<string, unknown>;
  tx_id?: string;
  tx_uri?: string;
  email?: string;
}

export interface RegisterResult {
  entity_id: string;
  alias?: string;
  message: string;
}

export interface UpdatePayload {
  standard: { protocol: string; version: string; schema_url?: string };
  metadata: { public_key: string; signature: string; [key: string]: unknown };
  identity: { names: string[]; [key: string]: unknown };
  capabilities?: Record<string, unknown>;
  endpoints?: Record<string, unknown>;
}

export interface ApiError {
  error: string;
  message?: string;
  // Payment required fields
  alias?: string;
  amount?: string;
  wallet_address?: string;
  currency?: string;
  chain?: string;
  instructions?: string;
}

export class AieosApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError,
  ) {
    super(body.message ?? body.error);
    this.name = 'AieosApiError';
  }
}

export interface ClientOptions {
  /** Defaults to https://api.aieos.org */
  baseUrl?: string;
}

export class AieosClient {
  private readonly base: string;

  constructor(options: ClientOptions = {}) {
    this.base = (options.baseUrl ?? 'https://api.aieos.org').replace(/\/$/, '');
  }

  /** Register a new agent. Throws AieosApiError on failure. */
  async register(payload: RegisterPayload): Promise<RegisterResult> {
    return this.post<RegisterResult>('/v1/register', payload);
  }

  /** Update an existing agent's profile. Throws AieosApiError on failure. */
  async update(payload: UpdatePayload): Promise<{ message: string }> {
    return this.put<{ message: string }>('/v1/update', payload);
  }

  /** Lookup an agent by entity_id, public key, or alias. */
  async lookup(identifier: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}/v1/lookup/${encodeURIComponent(identifier)}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: 'Unknown error' }))) as ApiError;
      throw new AieosApiError(res.status, body);
    }
    return res.json() as Promise<Record<string, unknown>>;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({ error: 'Unknown error' }))) as T | ApiError;
    if (!res.ok) throw new AieosApiError(res.status, json as ApiError);
    return json as T;
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({ error: 'Unknown error' }))) as T | ApiError;
    if (!res.ok) throw new AieosApiError(res.status, json as ApiError);
    return json as T;
  }
}
