# Static ads

## Build them as HTML

One template, every size: `render-static.mjs` sets `<html data-size="4x5">` plus `--w` / `--h`, so
CSS can adapt per size (`[data-size="9x16"] .headline { … }`).

```bash
node creative-review/scripts/render-static.mjs ad.html --sizes 1x1,4x5,9x16 --out out/v2
# → out/v2-1080x1080.png, out/v2-1080x1350.png, out/v2-1080x1920.png
```

Sizes: `1x1` 1080×1080 · `4x5` 1080×1350 · `9x16` 1080×1920 · `1.91x1` 1200×628.

Brand tokens:
- **VigoMD**: bg `#0F2A14` / `#07130A`, gold `#EDB210`, mint `#7AC47C`, cream `#F4F1E8`;
  Instrument Serif (headlines) + Geist (body). Logos in the vigomd repo `assets/`.
- **Nalena**: plum `#36254B`, pink `#BC5D91`, mauve `#785375`, bg `#F9F5FF`; Lora + Source Sans 3.
  Main disclaimer at the bottom, ≥ 85% opacity (see `index.html`).

Photos and product shots: use the brief's assets, or generate with the image tools available
(Higgsfield, Canva, Figma MCP), save them next to `ad.html`, and reference them from the template.

## Reading pins

`frames/all-pins.jpg` shows every pin numbered on the ad; `feedback.md` gives exact positions
(`x=50.0% from left, y=87.0% from top`). Find the element under that point. If the pin sits between
two elements, the note text decides; if it's still unclear, reply and ask.

## Uploading

Upload the size the reviewer has been reviewing (usually 4:5) as the version file. Render the other
sizes too and list them in `--notes`; once approved, deliver the full set.
