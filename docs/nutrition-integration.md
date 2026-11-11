# Nutrition feature integration

## Existing architecture and design

The existing browser JavaScript, Cloudflare Worker, authenticated Sites hosting, diary, targets, local persistence, import/export, camera flow, and three navigation destinations are retained. `web/style.css` is unchanged. Access is added through two existing-style links on the scan screen, settings rows, and one button on the progress screen. New forms use the existing dialog, field, button, card, and disclosure components.

There was no server database, inventory, profile, or weight history to migrate. The new state stays in browser-local storage, following the existing diary architecture. This does **not** provide cloud synchronization or database durability.

## Data ownership and migration

Sites supplies the authenticated user identity at its protected origin. The Worker injects only that user ID into a non-cacheable document; the app partitions diary and feature storage by that ID. The API rejects personal operations without the platform identity header. Identity is never accepted from JSON bodies or query parameters.

Storage keys:

- `nouri-diary-v1:<encoded-user-id>`: existing-format diary and targets, with optional component/source metadata.
- `nouri-nutrition-v1:<encoded-user-id>`: confirmed inventory, explicitly consented reusable corrections, profile, weight logs, completed-day attestations, target approvals, and target locks.
- `nouri-legacy-owner-v1`: records who migrated the former single-owner diary. Successful migration removes the unpartitioned legacy diary. A different signed-in user cannot claim that legacy diary later.

Anonymous pages do not read or write personal browser storage. A shared browser's storage is not an encrypted vault: browser/device security and the existing private Sites access boundary remain necessary. There are no server-side personal records or stored raw photos. Only an existing-style small optional diary thumbnail is retained locally. New local feature data is included in export/import; account-scoped reset deletes it without touching another user's namespace.

## Recognition and nutrition calculations

The model recognizes visible ingredients, cooking methods, qualitative recognition uncertainty, and estimated quantities. It never supplies the arithmetic used for new scan totals. Structured responses are validated on the server. Recognition and quantity confidence are separate labels, not calibrated percentages.

Every new calculated meal component uses an explicitly selected nutrition record and portion weight. Unknown foods or portions require correction/confirmation before diary logging. Confirmed packaged-food records in inventory can also be explicitly selected when correcting a meal; they are not silently equated with a generic recipe ingredient. Changing a component recalculates from per-100-unit data. Raw/cooked forms are distinct records. Oils, butter, sauces, and dressings are asked about explicitly. Reusable corrections require opt-in and remain suggestions requiring confirmation.

`null` means missing nutrition; it is distinct from zero. Missing core energy/protein/carbohydrate/fat values block calculated diary logging. Missing optional fiber/sugar values remain missing through totals, persistence, and export. Manually supplied label values are identified as user-entered, not externally verified.

## Refrigerator and recipes

Photo detection is editable. Only confirmed ingredients enter inventory; unknown quantities may remain explicitly unknown. The embedded generic catalog has four verified USDA records and three simple recipe combinations; it is deliberately limited. Meal recommendations are deterministic templates calculated from sourced nutrition records and ranked against remaining targets. Missing ingredients and quantity uncertainty must remain visible. Recommendations do not imply allergy suitability, current grocery availability, or exact visual quantities. Confirm additions/missing ingredients before logging a recipe. Logged meals use the same diary schema and nutrition calculations.

## Product database

Product lookup uses Open Food Facts through the server; see `nutrition-sources.md` for records, attribution, licenses, and data limitations. OFF is a community-maintained source; records may be incomplete or incorrect and should be checked against the package. A known database source is not a guarantee of laboratory accuracy.

Barcode camera detection uses browser support with an explicit manual barcode fallback. Unknown products have a manually entered label-data flow. Conflicting measurement bases stay explicitly unknown and cannot be logged as gram quantities. Product comparisons use consistent per-100 g or per-100 ml bases and never silently convert millilitres into grams. Price comparisons are unavailable without reliable current price data. No supermarket stock, price, or availability is invented.

## Adaptive energy estimates

The calculation is deterministic (Mifflin–St Jeor initialization; weekly medians and robust trend slope; an explicitly approximate kcal/kg conversion). Default observed estimates require at least 28 days, at least four weights in each seven-day bucket, and at least 80% explicitly complete intake days. Missing days are never filled with zero. Editing a day's intake invalidates its completeness attestation.

Defaults cap proposed changes to 100 kcal and 5% of the current target, apply a 1,500 kcal floor, and enforce a 14-day approval cooldown. Engine configuration is bounded. Recommendations expire and are checked against the target/goal the user actually reviewed. Nothing changes on inspection. Explicit approval changes the calorie target only; manually set macro targets remain intact. Manual target edits re-lock the targets. These are conservative budgeting estimates, not a measurement or diagnosis of metabolism.

## Configuration

- `OPENAI_API_KEY`: required secret for real meal/fridge recognition. Configure server-side through the approved OpenAI Developers workflow; never put it in client code, source, or the hosting manifest.
- `OPENAI_MODEL`: optional vision/structured-output model; default `gpt-4.1-mini`.
- `OFF_CONTACT_EMAIL`: optional application contact for the nutrition database User-Agent; use a monitored deployment contact.
- `NUTRITION_RATE_LIMITER`: optional Cloudflare rate-limiter binding exposing `limit({key}) -> {success}`. Configure globally appropriate enforcement before expanding traffic/access.

Without an OpenAI key, photo recognition returns an explicit unconfigured response. No recognition result is simulated. Product access and sourced/manual ingredient workflows do not require that key.

## Security and operational limits

All personal APIs require Sites identity, same-origin requests, bounded inputs, and rate limits. Photos are validated for allowed formats, actual structure, dimensions, and size. Upstream requests have timeouts and sanitized errors. OpenAI requests set `store: false`; this is not a claim about every provider retention policy. Images and user notes are not logged by application code.

Per-user, per-isolate rate protection is active even without a binding (10 AI and 60 product requests/minute). It is **not** a durable global quota across Worker isolates; use the optional binding for that. Product data caching is shared public catalog data, not personal photo or diary data. Upstream rate errors are surfaced rather than retried in a loop.

## Dependencies and build

`esbuild` is a development-only dependency used to bundle the modular Worker. There are no new runtime framework dependencies. `npm ci`, `npm run build`, and `npm test` reproduce packaging and the test suite.

## Verification limits

Unit/integration tests cover the calculation engines, structured recognition, provider errors, product normalization, missing values, storage isolation, migration, diary integration, target approval, and the built Worker. Mocked provider tests do not prove a deployed API credential works. Browser camera/BarcodeDetector support and visual rendering require real-device/browser verification; the managed browser control tool is unavailable in this session. No real AI photo call is claimed when credentials are absent.
