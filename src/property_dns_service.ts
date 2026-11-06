import { createHash } from "node:crypto";
import type { DnsRecordInput } from "./infrai_dns.ts";

export type PropertyDnsInput = {
  propertyId: string;
  domain: string;
  maintenanceTarget: string;
  tenantDocumentsTarget: string;
  inspectionReminder: string;
  mailExchange?: string;
};

export type PropertyDnsResult = {
  propertyId: string;
  zoneId: string;
  records: Array<{ name: string; recordType: DnsRecordInput["record_type"] }>;
};

export interface PropertyDnsGateway {
  getDomain(domain: string): Promise<{ zone_id: string }>;
  upsertRecord(input: DnsRecordInput, idempotencyKey: string): Promise<unknown>;
}

export function recordsForProperty(
  input: PropertyDnsInput,
  zoneId: string,
): DnsRecordInput[] {
  const records: DnsRecordInput[] = [
    {
      zone_id: zoneId,
      record_type: "TXT",
      name: `_maintenance.${input.domain}`,
      content: input.maintenanceTarget,
      ttl: 300,
      metadata: { propertyId: input.propertyId, purpose: "maintenance" },
    },
    {
      zone_id: zoneId,
      record_type: "CNAME",
      name: `documents.${input.domain}`,
      content: input.tenantDocumentsTarget,
      ttl: 300,
      metadata: { propertyId: input.propertyId, purpose: "tenant-documents" },
    },
    {
      zone_id: zoneId,
      record_type: "TXT",
      name: `_inspection.${input.domain}`,
      content: input.inspectionReminder,
      ttl: 300,
      metadata: { propertyId: input.propertyId, purpose: "inspection-reminder" },
    },
  ];

  if (input.mailExchange) {
    records.push({
      zone_id: zoneId,
      record_type: "MX",
      name: input.domain,
      content: input.mailExchange,
      ttl: 300,
      priority: 10,
      metadata: { propertyId: input.propertyId, purpose: "property-mail" },
    });
  }
  return records;
}

function writeKey(propertyId: string, record: DnsRecordInput): string {
  return createHash("sha256")
    .update(`${propertyId}:${record.zone_id}:${record.record_type}:${record.name}:${record.content}`)
    .digest("hex");
}

export async function syncPropertyDns(
  gateway: PropertyDnsGateway,
  input: PropertyDnsInput,
): Promise<PropertyDnsResult> {
  const domain = await gateway.getDomain(input.domain);
  const records = recordsForProperty(input, domain.zone_id);

  await Promise.all(
    records.map((record) =>
      gateway.upsertRecord(record, writeKey(input.propertyId, record)),
    ),
  );

  return {
    propertyId: input.propertyId,
    zoneId: domain.zone_id,
    records: records.map((record) => ({
      name: record.name,
      recordType: record.record_type,
    })),
  };
}
