import assert from "node:assert/strict";
import test from "node:test";
import type { DnsRecordInput } from "../src/infrai_dns.ts";
import { syncPropertyDns, type PropertyDnsGateway } from "../src/property_dns_service.ts";

test("resolves the zone before writing property records and reserves priority for MX", async () => {
  const events: string[] = [];
  const writes: DnsRecordInput[] = [];
  const keys = new Set<string>();
  const gateway: PropertyDnsGateway = {
    async getDomain(domain) {
      events.push(`get:${domain}`);
      return { zone_id: "zone_property_12" };
    },
    async upsertRecord(record, idempotencyKey) {
      events.push(`put:${record.name}`);
      writes.push(record);
      keys.add(idempotencyKey);
    },
  };

  const result = await syncPropertyDns(gateway, {
    propertyId: "property-12",
    domain: "building.example.com",
    maintenanceTarget: "https://admin.example.com/requests/property-12",
    tenantDocumentsTarget: "files.example.com",
    inspectionReminder: "next=2027-02-01;cadence=annual",
    mailExchange: "mail.example.com",
  });

  assert.equal(events[0], "get:building.example.com");
  assert.equal(writes.length, 4);
  assert.ok(writes.every((record) => record.zone_id === "zone_property_12"));
  assert.deepEqual(
    writes.filter((record) => record.priority !== undefined).map((record) => record.record_type),
    ["MX"],
  );
  assert.equal(keys.size, writes.length);
  assert.equal(result.zoneId, "zone_property_12");
});
