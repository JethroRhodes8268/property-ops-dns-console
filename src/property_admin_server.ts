import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiDnsClient, InfraiError } from "./infrai_dns.ts";
import { syncPropertyDns } from "./property_dns_service.ts";

const bodySchema = z.object({
  propertyId: z.string().min(1),
  domain: z.string().min(3),
  maintenanceTarget: z.string().url(),
  tenantDocumentsTarget: z.string().min(3),
  inspectionReminder: z.string().min(1),
  mailExchange: z.string().min(3).optional(),
}).strict();

const recordSchema = z.object({
  domain: z.string().min(3),
  record_type: z.enum(["TXT", "CNAME", "MX", "A"]),
  name: z.string().min(1),
  content: z.string().min(1),
  ttl: z.number().int().positive().optional(),
  priority: z.number().int().nonnegative().optional(),
  record_id: z.string().min(1).optional(),
  metadata: z.record(z.string()).optional(),
}).strict();

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the server");
const dns = new InfraiDnsClient(apiKey);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/property-dns") {
    send(response, 404, { error: "Route not found" });
    return;
  }

  try {
    if (request.method === "PUT") {
      const input = bodySchema.parse(await readJson(request));
      // Zod validates these fields; keep them required even without strictNullChecks.
      send(response, 200, await syncPropertyDns(dns, {
        ...input,
        propertyId: input.propertyId!,
        domain: input.domain!,
        maintenanceTarget: input.maintenanceTarget!,
        tenantDocumentsTarget: input.tenantDocumentsTarget!,
        inspectionReminder: input.inspectionReminder!,
      }));
      return;
    }

    const recordInput = request.method === "PATCH"
      ? recordSchema.parse(await readJson(request))
      : undefined;
    const domain = z.string().min(3).parse(
      recordInput?.domain ?? url.searchParams.get("domain"),
    );
    const { zone_id } = await dns.getDomain(domain);

    if (request.method === "GET") {
      send(response, 200, await dns.listRecords(zone_id));
      return;
    }
    if (request.method === "PATCH") {
      const { domain: unusedDomain, ...record } = recordInput!;
      void unusedDomain;
      send(response, 200, await dns.updateRecord(
        {
          zone_id,
          ...record,
          record_type: record.record_type!,
          name: record.name!,
          content: record.content!,
        },
        createHash("sha256").update(JSON.stringify({ zone_id, ...record })).digest("hex"),
      ));
      return;
    }
    if (request.method === "DELETE") {
      send(response, 200, await dns.deleteRecords(zone_id));
      return;
    }
    send(response, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request body", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      send(response, status, { error: error.code, detail: error.detail });
      return;
    }
    console.error(error);
    send(response, 500, { error: "Request could not be completed" });
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Property DNS admin listening on http://localhost:${port}`));
