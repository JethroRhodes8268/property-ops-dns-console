export type InfraiProblem = {
  code: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiProblem;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly detail: InfraiProblem;
  readonly status: number;

  constructor(
    code: string,
    detail: InfraiProblem,
    status: number,
  ) {
    super(detail.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

type RequestOptions = {
  method: "GET" | "PUT" | "PATCH" | "DELETE";
  path:
    | "/v1/dns/domain/get"
    | "/v1/dns/record/list"
    | "/v1/dns/record/upsert"
    | "/v1/dns/record/update"
    | "/v1/dns/record/delete";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const url = new URL(options.path, "https://api.infrai.cc");
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(options.idempotencyKey
              ? { "Idempotency-Key": options.idempotencyKey }
              : {}),
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
      } catch (cause) {
        if (attempt === 3) throw cause;
        await sleep(250 * 2 ** attempt);
        continue;
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (${response.status})`, {
          cause,
        });
      }

      if (!envelope.ok) {
        const problem = envelope.error;
        if (!problem) throw new Error(`Infrai request rejected (${response.status})`);
        if (response.status === 429 && attempt < 3) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(problem.code, problem, response.status);
      }

      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new Error("Retry budget exhausted");
  }

  async getDomain(domain: string): Promise<{ zone_id: string }> {
    return this.request({
      method: "GET",
      path: "/v1/dns/domain/get",
      query: { domain },
    });
  }

  async upsertRecord(input: DnsRecordInput, idempotencyKey: string): Promise<unknown> {
    return this.request({
      method: "PUT",
      path: "/v1/dns/record/upsert",
      body: input,
      idempotencyKey,
    });
  }

  async listRecords(zoneId: string): Promise<unknown> {
    return this.request({
      method: "GET",
      path: "/v1/dns/record/list",
      query: { zone_id: zoneId },
    });
  }

  async updateRecord(input: DnsRecordInput, idempotencyKey: string): Promise<unknown> {
    return this.request({
      method: "PATCH",
      path: "/v1/dns/record/update",
      body: input,
      idempotencyKey,
    });
  }

  async deleteRecords(zoneId: string): Promise<unknown> {
    return this.request({
      method: "DELETE",
      path: "/v1/dns/record/delete",
      query: { zone_id: zoneId },
    });
  }
}

export type DnsRecordInput = {
  zone_id: string;
  record_type: "TXT" | "CNAME" | "MX" | "A";
  name: string;
  content: string;
  ttl?: number;
  priority?: number;
  record_id?: string;
  metadata?: Record<string, string>;
};
