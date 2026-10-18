# Receipts per country, and the state integration

A receipt is no longer Dutch by construction. The organisation's country (`organizations.country`, set in the business setup) decides what a valid receipt is, and for the countries that have a fiscal system it decides which step a receipt goes through before it is final.

All of this is **research, not legal advice**: the rates, formats and fiscal fields below were compiled by hand in October 2026 from public sources next to `docs/legal-research`, and nothing here has been reviewed by a tax adviser. The state integrations ship in **sandbox mode**: they produce made-up data in the shape of each country's system and send nothing to any authority.

## What differs per country

`@lr/compliance` (`src/formats.ts`, import `@lr/compliance/formats` from front ends: it is small) has one entry per country, 31 in all:

| field | meaning |
| --- | --- |
| `currency` | ISO 4217. A receipt must be in it (`currency_mismatch`). |
| `vatRates` | every rate a line can carry, with decimals (FR 5.5 and 2.1, CH 8.1, FI 25.5, IE 13.5 and 4.8). Anything else is `vat_rate_not_allowed`. |
| `cashRoundingStep` | minor units: NL/BE/FI/IE/CH 5, DK 50, NO/CZ 100, HU 500, none elsewhere. A rounding outside ±step/2 is `rounding_range`. |
| `timezone`, `locale` | how the wallet, the PDF and the dashboard show time and numbers. |
| `fiscal` | `none` (a paid receipt is final), `required` (final only once `fiscalised`) or `optional` (BE: horeca only; both are final). |
| `idLabels` | what is printed in front of the company and VAT numbers: KvK/BTW, SIRET/TVA, Steuernr./USt-IdNr., and so on. |

The company registry number and the VAT number are checked with the patterns of the legal research (`companyIdProblem`, `vatIdProblem`); NL keeps its strict 8-digit KvK and `NL…B..` BTW-id. Countries the research has no pattern for accept any value.

Two things are the same everywhere:

- **Money is integer minor units = 1/100 of the currency unit**, also for HUF and ISK (they print without decimals; cash is rounded to whole units).
- **The canonical receipt format keeps its names.** `merchant.kvkNumber` is the company registry number of the country (the name is historical, the column `organizations.kvk_number` the same). `receipt_lines.vat_rate` became `numeric(5,2)` (migration 0009).

`validateCrf(receipt, { country })` applies all of it; the merchant API calls it with the organisation's country on every upload, so a terminal cannot sign a receipt that does not fit the country.

## The state integration

`@lr/fiscal` is the integration point with the state, one per country. For the 20 countries whose receipts have a fiscal step (19 required, BE optional) it has a **spec** (`FISCAL_SPECS`): the system, the authority, one sentence on how it works, the settings it reads from the business setup (`needs`) and the fields it adds to the receipt (`fields`, stored in `crf.fiscal.extra`):

| country | system | fields |
| --- | --- | --- |
| AT | RKSV | Kassen-ID, Belegnummer, Signatur, QR |
| BE | GKS / FDM (horeca; optional) | FDM, Ticket, Handtekening |
| BG | NRA fiscal device | device id, fiscal receipt no., QR |
| CY | ETR fiscal device | device, receipt no. |
| DE | TSE (KassenSichV) | TSE serial, till id, transaction number, signature counter, start, end, signature |
| ES | Verifactu | invoice id, hash, previous hash, QR |
| FR | certified till software (NF525) | sequence, hash, software |
| GR | myDATA / FIM | MARK, UID, FIM, QR |
| HR | Fiskalizacija (CIS) | ZKI, JIR, receipt no., QR |
| HU | NAV online cash register | AP number, receipt no., NAV id |
| IT | Registratore Telematico | RT serial, commercial document no., closure |
| LT | i.EKA | register no., receipt no., signature |
| LV | fiscal memory register | module id, receipt no., signature |
| MT | fiscal register | register serial, receipt no. |
| PL | kasa fiskalna / online | register no., receipt no., CRK id |
| PT | certified invoicing software | ATCUD, document, hash, QR |
| RO | AMEF | AMEF serial, receipt no., ANAF id |
| SE | Kontrollenhet | control unit, register, receipt no., control code |
| SI | FURS | ZOI, EOR, invoice no., QR |
| SK | eKasa | receipt uid, OKP, register code, QR |

The other 11 (NL, GB, IE, DK, CH, CZ, EE, FI, IS, LU, NO) have no fiscal step: a paid receipt is final.

### How a receipt goes through it

The till runs the step, because that is where the fiscal device (a TSE, an RT, a control unit) lives:

```
presented -> paid  --(StateIntegration.submit)-->  fiscalised   (final, carries the fiscal data)
```

`TerminalSdk` takes `country` and `fiscal: { integration?, settings?, state?, auto? }`. When a receipt is paid in a country with a required fiscal step, the SDK calls `integration.submit({ receipt, settings, state, terminalId })`, and queues a `fiscalised` version signed with what comes back (`documentNumber`, `registerSerial`, `extra`). A retryable failure (gateway down, 5xx, 429) leaves the receipt `paid`; `sdk.fiscalise(receiptId)` tries again. A permanent refusal throws `FiscalError`. `auto: false` leaves the call to the till.

The buyer's wallet treats a receipt as final by `isFinalState(state, country)`: `paid` for NL and the countries without a step, `fiscalised` where the step is required.

### Three implementations

- **`sandboxIntegration(country)`**, the default. Counters, hash chains and signature-like strings with the right shape per country, kept in a `FiscalStateStore` (memory by default; the dashboard simulator keeps it in `localStorage`). Every receipt carries `extra.mode = "sandbox"`, QR payloads point at `sandbox.invalid` (a reserved domain), and a register serial that starts with `SBX-` unless the business entered a real one. Nothing is sent anywhere.
- **`gatewayIntegration({ country, url, apiKey })`**, the live contract. POSTs `{ country, receipt, settings }` and expects `{ documentNumber?, registerSerial?, extra }` with every field of the country's spec. Put your certified provider, a TSE driver or a national API client behind it. It is covered by tests with a fake server, **not** run against any real service.
- **Your own `StateIntegration`**: one method, `submit`.

### Adding or changing a country

1. `packages/compliance/src/formats.ts`: currency, rates, rounding, zone, locale, `fiscal`, id labels.
2. If it has a fiscal step: a spec in `packages/fiscal/src/specs.ts` and a builder in `packages/fiscal/src/sandbox.ts`. The tests in `packages/fiscal/test` fail when a country has a spec without a builder (or the other way round), when a spec reads a setting that the legal research does not have, and when a sandbox answer does not fit the schema limits.
3. `packages/compliance/src/data/countries.json` (the legal text and the settings) comes from `docs/legal-research` through `pnpm --filter @lr/compliance build-data`.

## Where you see it

- **Dashboard, Organisation:** a card with the receipt format of the country (currency, rates, rounding, time zone, id labels) and its state integration: the system, the fields added to every receipt, which of the settings it reads are filled in.
- **Dashboard, Simulator:** a till with a menu priced in the currency and with the rates of the country; the integration panel shows the fiscal data of the last receipt. Change the country in the setup, then reset the terminal.
- **Dashboard, Receipt design:** the sample receipt is in the country's currency with its fiscal fields.
- **Wallet:** amounts in the receipt's currency, times in the country's zone, `Steuernr.`/`USt-IdNr.` instead of `KvK`/`BTW`, the fiscal fields with their names. Totals (home, insights, balances) are in the person's main currency, the one of their latest final receipt; they never add euros to zloty.
- **PDF:** the same, with Roboto instead of the PDF standard fonts when a receipt has text they cannot draw (Polish, Czech, Hungarian, Greek, Cyrillic, ...).

## Not done

- Photo extraction (the OCR parser, `packages/receipt-nl`) still reads Dutch receipts only.
- No integration is run against a real device or authority. The field lists and formats are from the research; take the real ones from the certification documents of what you integrate.
- Void receipts of a fiscalised receipt carry the original fiscal data; a real system needs a cancellation document sent to the authority.
- The friends feed (activity) shows amounts in the person's main currency.
- Templates and the wallet UI exist in English and Dutch only; fiscal labels are in the language of the country.
