#!/usr/bin/env node
// render-static.mjs — render an HTML ad template to PNGs at Meta sizes.
//
//   node scripts/render-static.mjs ad.html                      → ad-1080x1350.png (4:5)
//   node scripts/render-static.mjs ad.html --sizes 1x1,4x5,9x16 → one PNG per size
//   node scripts/render-static.mjs ad.html --out out/v2
//
// Why HTML: a reviewer's pin ("CTA bigger", "swap this image") maps to one CSS rule
// or one element, so v2 changes exactly what was asked and nothing else. The page
// gets `data-size="4x5"` on <html> and CSS vars --w/--h so one template can lay
// itself out per size.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SIZES = { "1x1": [1080, 1080], "4x5": [1080, 1350], "9x16": [1080, 1920], "1.91x1": [1200, 628] };

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
if (!file) {
  console.log("usage: render-static.mjs <ad.html> [--sizes 1x1,4x5,9x16] [--out prefix]");
  process.exit(1);
}

let chromium;
for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs"]) {
  try {
    ({ chromium } = await import(spec));
    break;
  } catch {
    /* try next */
  }
}
if (!chromium) {
  console.error("✗ Playwright not found. `npm i -D playwright` (browsers: `npx playwright install chromium`).");
  process.exit(1);
}

const html = path.resolve(file);
const prefix = path.resolve(flag("out", html.replace(/\.html?$/, "")));
fs.mkdirSync(path.dirname(prefix), { recursive: true });
const browser = await chromium.launch();
for (const key of flag("sizes", "4x5").split(",")) {
  const [w, h] = SIZES[key.trim()] ?? die(`unknown size ${key}; use ${Object.keys(SIZES).join(", ")}`);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(([k, ww, hh]) => {
    document.documentElement.dataset.size = k;
    document.documentElement.style.setProperty("--w", `${ww}px`);
    document.documentElement.style.setProperty("--h", `${hh}px`);
  }, [key.trim(), w, h]);
  await page.evaluate(() => document.fonts.ready);
  const out = `${prefix}-${w}x${h}.png`;
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`✓ ${path.relative(process.cwd(), out)}`);
  await page.close();
}
await browser.close();

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}
