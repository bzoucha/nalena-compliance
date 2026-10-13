---
name: ai-ad-editor
description: AI video editor and static-ad reviser wired to Vigo Review (the frame.io-style review room in creative-review/). Use when asked to check the review/edit queue, edit a video from a brief + footage, apply timestamped feedback, make the next version (v2, v3…), revise a static ad from pinned notes, or "run the editor loop". Pulls the job, edits with ffmpeg through an edit.json timeline (or an HTML template for statics), uploads the next version, closes every note with what changed, and turns recurring feedback into playbook rules so each round gets better.
---

# AI ad editor

You are the editor in this loop:

```
brief + footage ─▶ you cut v1 ─▶ upload ─▶ reviewer leaves timestamped / pinned notes
       ▲                                                     │
       └──── you apply every note, upload v(n+1) ◀───────────┘   … until "Approved"
                         │
                         └─▶ recurring notes become playbook rules (loaded on every future edit)
```

Everything goes through `creative-review/scripts/review-cli.mjs` (call it `review` below) and
`creative-review/scripts/render.mjs`. Paths are relative to the repo root.

## 0. Setup (once per session)

- `REVIEW_URL` (e.g. `https://creative.vigomd.com`) and `REVIEW_API_KEY` must be set — env vars or
  `creative-review/.env.local`. Without them, stop and ask for them.
- `cd creative-review && npm ci` (the CLI needs `@vercel/blob` to upload in production).
- `ffmpeg -version` must work. Statics also need Playwright (`render-static.mjs`).

## 1. Load the playbook first — every time

```bash
node creative-review/scripts/review-cli.mjs rules --write .claude/skills/ai-ad-editor/learned-rules.md
```

Read `learned-rules.md`. These rules came from real feedback on real cuts; they are not optional.
A rule tagged `[VIG only]` applies only to that brand. If a rule conflicts with the brief, the brief
wins for that job — say so in the version notes.

## 2. Pick up a job

```bash
review jobs                                   # queued briefs + projects with notes waiting
review claim <projectId> --by "Claude"        # marks it "AI editing" in the UI
review pull  <projectId> --dir review-work/<projectId>
```

`pull` writes:

| file | what it is |
|---|---|
| `brief.md` | the brief (angle, hooks, script, format) |
| `footage/` | raw source files |
| `versions/vN.*` | the latest cut the reviewer watched |
| `feedback.md` | every open note: timecode (or range), pin position, replies, `comment_id` |
| `frames/note-NN-*.jpg` | the exact frame each note points at, pin drawn as a yellow box + number |
| `frames/all-pins.jpg` | statics: every pin on one image |
| `rules.md` | the playbook rules that apply to this project |
| `job.json` | all of the above as JSON |

**Look at every frame image** (Read tool) before changing anything. A note like "this is too busy"
only makes sense with the frame in front of you.

## 3a. Video — first cut (v1)

1. Read `brief.md`. Probe every source: `ffprobe -v error -show_entries format=duration:stream=width,height,codec_type -of compact footage/*`.
2. Write `review-work/<id>/edit.json` — the full timeline: clips (src, in, out), on-screen text,
   captions, overlays, music. Schema and craft notes: `references/edit-json.md`.
3. `node creative-review/scripts/render.mjs render review-work/<id>/edit.json`
4. QA before upload: `node creative-review/scripts/render.mjs sheet <out.mp4>` and look at the
   sheet. Check the hook lands in the first 1.5 s, captions stay inside safe zones, nothing is
   cropped badly, the CTA is on screen at the end, duration matches the brief.
5. Upload:
   ```bash
   review upload <projectId> review-work/<id>/out/v1.mp4 --by "Claude" \
     --notes "v1: hook A (0–2.1s) → problem → product → CTA. Captions on, music bed at 16%."
   ```

Keep `edit.json` next to the cut. **It is the source of truth for every later round.**

## 3b. Video — applying feedback (v2, v3 …)

For each note in `feedback.md`:

1. Map the timecode to the edit:
   `node creative-review/scripts/render.mjs locate edit.json 12.4` → which clip, which source second,
   which text/caption is on screen at that moment.
2. Make the **smallest change that fully answers the note**. Don't "improve" things nobody asked
   about — unchanged parts should be frame-identical so the reviewer can trust the diff. Exception:
   a playbook rule that v(n) violated must be fixed, and you list it in the notes.
3. Range notes (`@00:03.1–00:03.8`) are about that whole span. General notes apply to the whole cut.
4. Write one line per note saying what you did, with the new timecode if things moved:
   `"Trimmed the bars segment 1.33s → 0.67s; everything after shifts 0.66s earlier."`

Then re-render, run `sheet` **at the original note timecodes** (`render.mjs sheet out/v2.mp4 3.1 12.4 …`)
to confirm each fix is visible, and upload with every note resolved:

```bash
review upload <projectId> out/v2.mp4 --by "Claude" \
  --notes "v2: captions moved to the top third; bars segment halved; music +10%." \
  --resolve recAAA="Moved captions to y=0.22 for the whole cut." \
  --resolve recBBB="Cut the bars segment from 1.33s to 0.67s." \
  --resolve recCCC="Music bed 0.16 → 0.18."
```

If a note is ambiguous or you can't do it (missing footage, contradicts the brief), **don't
guess and don't resolve it** — reply and leave it open:
`review reply <projectId> <commentId> "Is the 'logo' the VigoMD wordmark or the V3 pack shot?"`
Upload the rest anyway; the reviewer sees the open note flagged on the next version.

## 3c. Statics

- v1 from a brief: build the ad as an HTML template (brand tokens, real copy) and render every size
  the brief asks for with `node creative-review/scripts/render-static.mjs ad.html --sizes 1x1,4x5,9x16 --out out/v1`.
  Image-model tools (Canva, Higgsfield, Figma MCP) are fine for visuals; keep text in HTML so edits are exact.
  See `references/statics.md`.
- Revisions: open `frames/all-pins.jpg` and each `note-NN.jpg`. A pin at x=50%, y=87% is a precise
  location — change the element there. Re-render at the **same dimensions**, upload one file per
  project (the 4:5 unless the brief says otherwise; mention the other sizes in `--notes`).

## 4. Learn — make the next edit better

After every round, read the notes you just applied and ask: **would this apply to a future ad?**

- Yes, and it's general ("captions never cover faces", "hooks under 2 s", "no stock-looking b-roll"):
  ```bash
  review propose-rule "Keep captions in the top third when a face is centre-frame" \
    --scope video --from <commentId> --project <projectId> --detail "From V3 hook test v1 @00:01.1"
  ```
  It lands as *Proposed* in the Playbook; the reviewer approves it, and from then on it's in
  `learned-rules.md` for every job.
- Brand-specific → add `--brand VIG` (or NAL / MED).
- One-off taste for this ad ("make this shot bluer") → don't propose it.
- The reviewer already starred it (★ save to playbook) → it's already active; don't duplicate.

Never propose more than ~3 rules per round. Phrase them as instructions you could follow blind.

## 5. Finish

`review jobs` should no longer list the project. Tell the user: project name, version uploaded, the
link the CLI printed, each note and what you did, any notes left open (and why), and rules proposed.
If the repo is a git checkout and `learned-rules.md` changed, include it in your commit so the skill
itself carries the memory.
