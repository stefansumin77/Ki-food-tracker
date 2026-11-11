# Nutrition sources

`web/nutrition.js` contains only source-verified records. Empty catalog states are intentionally not replaced with AI-generated nutrition values.

Product data is fetched from Open Food Facts. Open Food Facts is a community-maintained database; missing nutrient values remain `null` and users are asked to verify packaging. Database: Open Database License (ODbL). Individual contents: Database Contents License (DbCL). See https://world.openfoodfacts.org/terms-of-use and https://world.openfoodfacts.org/data.

Generic food data uses source URLs and record identifiers attached to each catalog row. Cooked and raw foods are distinct records; unknown preparation states are not silently substituted. Recipe calculations use the exact source food records and deterministic portion scaling.

## Catalog records retrieved 2026-11-11

The following official USDA FoodData Central API records were retrieved from the official API using its documented public DEMO_KEY. No runtime USDA credential is required for the embedded snapshot. Nutrients correspond to the records' per-100-g values, not laboratory measurements of a user's serving.

| App ID | FDC ID | Exact source description | Preparation | kcal / protein / carbs / fat / fiber / sugar per 100 g |
| --- | --- | --- | --- | --- |
| rice-cooked | 168878 | Rice, white, long-grain, regular, enriched, cooked | cooked | 130 / 2.69 / 28.17 / 0.28 / 0.4 / 0.05 |
| chicken-roasted | 171477 | Chicken, broilers or fryers, breast, meat only, cooked, roasted | roasted | 165 / 31.02 / 0 / 3.57 / 0 / 0 |
| lentils-cooked | 172421 | Lentils, mature seeds, cooked, boiled, without salt | cooked | 116 / 9.02 / 20.13 / 0.38 / 7.9 / 1.8 |
| tofu-raw | 172475 | Tofu, raw, firm, prepared with calcium sulfate | raw | 144 / 17.27 / 2.78 / 8.72 / 2.3 / missing |

Official JSON source URL pattern: `https://api.nal.usda.gov/fdc/v1/food/<FDC-ID>?api_key=DEMO_KEY`; public record pages are attached to each food object. SR Legacy publication date: 2019-04-01. The tofu record has no total-sugars value; `sugar` therefore remains `null`. The catalog is deliberately small rather than populated with unverified values. Unknown foods require product-database selection or manual nutrition entry.

Recipes are simple nouri assembly templates, not AI-generated nutrition arithmetic. Missing ingredients and unknown inventory quantities are shown explicitly. No recipe assumes unlogged oil, sauces or dressings.

## Product measurement basis

Package volume units (including a label such as `500 ml`) are honored even when no serving is provided. Conflicting explicit mass and volume declarations produce `unit: unknown` and an unknown nutrient basis; no portion scaling or diary logging is permitted until the user verifies packaging through manual entry. A volume is never converted to a fictitious gram weight.

Open Food Facts requests identify nouri, its version, the Cloudflare Worker platform and the actual application's HTTPS origin. A real maintainer address can additionally be configured with `OFF_CONTACT_EMAIL`; none is invented.
