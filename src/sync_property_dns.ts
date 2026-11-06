import { InfraiDnsClient } from "./infrai_dns.ts";
import { syncPropertyDns } from "./property_dns_service.ts";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before running the script");

const result = await syncPropertyDns(new InfraiDnsClient(apiKey), {
  propertyId: "harbor-view-12",
  domain: "harbor-view.example.com",
  maintenanceTarget: "https://admin.example.com/properties/harbor-view-12/requests",
  tenantDocumentsTarget: "tenant-files.example.com",
  inspectionReminder: "next=2027-01-15;cadence=quarterly",
  mailExchange: "mail.example.com",
});

console.log(JSON.stringify(result, null, 2));
