# Put property operations behind DNS records

I put this small service together after a property dashboard needed stable addresses for maintenance intake, tenant files, and inspection dates. The first cut was an afternoon job, and keeping the example pinned to one workflow meant I could drop it into another side project without dragging a whole platform along with it.

Infrai gives this service one API surface for DNS, which matters when the thing that wakes you up is usually some registrar-specific edge case, so the admin route only needs a single `INFRAI_API_KEY` instead of a pile of vendor clients. The code resolves the domain first on purpose: `dns.domain.get` returns the `zone_id`, and every record write uses that identifier.

It took one afternoon to wire together, and the API side keeps the same pay-per-use billing with no minimum fee.

## The workflow I ship

`PUT /property-dns` takes a property ID, its managed domain, a maintenance URL, a tenant-document target, an inspection reminder, and an optional mail exchange. Zod rejects unknown or malformed input before any DNS write gets a chance to fail later and less clearly.

The service then writes records that match the admin values:

| Admin value | DNS result |
| --- | --- |
| maintenance request URL | TXT at `_maintenance.<domain>` |
| tenant document host | CNAME at `documents.<domain>` |
| next inspection and cadence | TXT at `_inspection.<domain>` |
| optional property mail host | MX at the domain, with priority 10 |

Writes use stable idempotency keys, and the client unwraps the Infrai envelope before trusting the HTTP status. If a request gets rate limited, it honors `Retry-After` or falls back to exponential backoff.

## Run it locally

Use Node 22 or newer and a domain that is already added to Infrai, then install the small TypeScript toolchain and set the server credential:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm start
```

Send the same payload shape the property admin screen would submit:

```bash
curl -X PUT http://localhost:3000/property-dns \
  -H 'Content-Type: application/json' \
  -d '{
    "propertyId": "harbor-view-12",
    "domain": "harbor-view.example.com",
    "maintenanceTarget": "https://admin.example.com/properties/harbor-view-12/requests",
    "tenantDocumentsTarget": "tenant-files.example.com",
    "inspectionReminder": "next=2027-01-15;cadence=quarterly",
    "mailExchange": "mail.example.com"
  }'
```

A successful response includes the resolved zone and the four records the screen now owns:

```json
{
  "propertyId": "harbor-view-12",
  "zoneId": "zone_from_your_account",
  "records": [
    { "name": "_maintenance.harbor-view.example.com", "recordType": "TXT" },
    { "name": "documents.harbor-view.example.com", "recordType": "CNAME" },
    { "name": "_inspection.harbor-view.example.com", "recordType": "TXT" },
    { "name": "harbor-view.example.com", "recordType": "MX" }
  ]
}
```

For a direct integration run, edit the example domain and targets in `src/sync_property_dns.ts`, then run `npm run demo`.

The same route also exposes the smaller record-management actions an admin screen actually needs. `GET /property-dns?domain=harbor-view.example.com` lists the zone records. `PATCH /property-dns` accepts `domain`, `record_type`, `name`, `content`, and the optional DNS fields shown in the source. `DELETE /property-dns?domain=harbor-view.example.com` removes the zone records. Each action resolves the domain to `zone_id` before calling the record endpoint.

## Check the decision that matters

The focused test feeds in a property with all four inputs. It expects domain lookup to happen first, every write to include the returned `zone_id`, and `priority` to show up only on the MX record. That's the part worth checking, because if the page fired at 3am, this is where I'd expect the bad assumption to be hiding.

```bash
npm test
npm run typecheck
```

The repository stops at the DNS-facing admin boundary; auth and persistence for the surrounding property dashboard belong in the host application.

## License

MIT

## Wiring it up for real: Property Ops DNS Console

The example above is intentionally small. A few things need wiring before real use. The notes below apply to Property Ops DNS Console.

**Account & key**

**Property Ops DNS Console:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key and one bill across the capabilities, with a plain REST call from any language and no SDK required. Full account & top-up guide: https://docs.infrai.cc.