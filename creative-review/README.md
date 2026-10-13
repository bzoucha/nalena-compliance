# Vigo Review — frame.io-style review for AI edits and static ads

A review room for the Vigo Creative studio. You give the AI editor a brief and footage, it uploads a
cut, you leave **timestamped notes** (or pin them on the frame), it applies them and uploads the
**next version**, and you repeat until you approve. Notes you star — and patterns the AI spots —
become **playbook rules** that the editor loads before every edit, so it gets better the more you use it.

Statics work the same way: pin notes on the image, send back, approve.

This is for **AI edits and static approvals**. Human-editor briefs still run through the Airtable +
Drive pipeline (Briefs → Claim → Review Submissions).

```
  Reviewer (browser)                     Vigo Review (Next.js)                AI editor (Claude + skill)
  ──────────────────                     ─────────────────────                ─────────────────────────
  New project: brief + footage ───────▶  Project: queued
                                         GET /api/review/agent/jobs ◀──────── review jobs / claim / pull
                                                                              edit.json → render.mjs → v1.mp4
                                         POST …/versions (v1) ◀────────────── review upload
  watch v1, notes @00:03.1, pins ──────▶ Comments (timecode, range, x/y)
  "Request changes" ──────────────────▶  Project: changes_requested
                                         jobs: notes + frames + rules ──────▶ review pull (frame per note)
                                                                              locate → fix → render v2
                                         POST …/versions (v2, resolutions) ◀─ review upload --resolve id="…"
  "What changed", compare v1↔v2,
  Approve ────────────────────────────▶  Project: approved
  ★ save to playbook / approve AI's ──▶  Rules ─────────────────────────────▶ review rules --write learned-rules.md
  proposed rules
```

## What's in the box

| | |
|---|---|
| **Review room** `/review/[id]` | Custom player: scrub timeline with note markers, frame-step, J/K/L, speed, loop a range, fullscreen. Notes capture the playhead when you start typing; `I`/`O` make a range; `P` drops a pin on the frame. Version switcher, side-by-side compare (synced playback), "What changed" panel showing how each note was resolved, Approve / Request changes. |
| **Statics** | Same room for images: click the ad to pin a note, compare versions side by side. |
| **Dashboard** `/review` | Needs you · With the AI · Approved, live-updating. |
| **Playbook** `/review/playbook` | Active rules, AI-proposed rules to approve, retired rules. |
| **Setup** `/review/setup` | Env checklist + one-click Airtable table creation. |
| **AI editor CLI** `scripts/review-cli.mjs` | `jobs`, `claim`, `pull` (brief, footage, latest cut, notes, **a still per note with the pin drawn on it**), `upload --resolve`, `reply`, `rules --write`, `propose-rule`. |
| **Renderer** `scripts/render.mjs` | `edit.json` timeline → MP4 (clips, speed, stills with push-in, text, burned captions, logo, ducked music, VO). `locate` maps a note's timestamp back to the clip and source second; `sheet` makes QA contact sheets. |
| **Static renderer** `scripts/render-static.mjs` | HTML template → PNG at 1:1 / 4:5 / 9:16. |
| **Skill** `../.claude/skills/ai-ad-editor` | The loop Claude follows, including compliance checks and how to learn from feedback. |

## Deploy

### 1. Where it lives

It's built in the same stack as creative.vigomd.com (Next.js 16 App Router, Tailwind v4, Geist /
Instrument Serif, the studio's colour tokens), so either works:

- **Inside the studio app (recommended)**: copy `app/review`, `app/api/review`, `app/login` (or keep
  the studio's own login), `components/review`, `lib/review`, `scripts`, and `proxy.ts` (merge the
  matcher with the studio's own proxy). Merge `app/globals.css` (component styles go in
  `@layer components`). Replace `callerOf()` in `lib/review/auth.ts` with the studio's session check,
  keeping the bearer-key branch for the AI.
- **Standalone**: deploy this folder as its own Vercel project (Root Directory = `creative-review`),
  e.g. at `review.vigomd.com`.

### 2. Environment variables (Vercel → Settings → Environment Variables)

| var | value |
|---|---|
| `REVIEW_PASSWORD` | team password |
| `REVIEW_SESSION_SECRET` | long random string |
| `REVIEW_API_KEY` | long random string — give the same value to the AI editor |
| `REVIEW_STORE` | `airtable` |
| `AIRTABLE_TOKEN` | personal access token: `data.records:read`, `data.records:write` (+ `schema.bases:read/write` for setup) |
| `AIRTABLE_REVIEW_BASE_ID` | `appLGOqZqpYEgSKum` (Vigo MD - Ads) or a new base |
| `REVIEW_FILES` | `blob` |
| `BLOB_READ_WRITE_TOKEN` | added automatically when you connect a Blob store (Storage → Create → Blob) |
| `REVIEW_WEBHOOK_URL` | optional: JSON POST on queued / new version / changes requested / approved (Make, Slack workflow, Telegram relay) |
| `REVIEW_PUBLIC_URL` | e.g. `https://creative.vigomd.com`, used in notification links |

### 3. Airtable tables

Open `/review/setup` and click **Create tables**. This adds `Review Projects`, `Review Versions`,
`Review Comments` and `Review Rules` to the base and leaves existing tables untouched. You can also
ask Claude to create them with the Airtable connector; the schema is in `lib/review/schema.ts`.

### 4. The AI editor

In a Claude Code session on this repo (local or cloud), with `REVIEW_URL` and `REVIEW_API_KEY` set:

> "Check the review queue and work through it."

The `ai-ad-editor` skill handles the rest. To run it automatically, schedule a routine
(for example hourly) with that prompt, or trigger it from the `REVIEW_WEBHOOK_URL` notification.

## Local dev

```bash
cp .env.example .env.local     # REVIEW_STORE=json, REVIEW_FILES=local need no accounts
npm install
npm run dev                    # http://localhost:3000/review
```

Data goes to `.data/` (git-ignored). Without `REVIEW_PASSWORD`, dev runs without a login.

## API (cookie session or `Authorization: Bearer $REVIEW_API_KEY`)

| method | path | |
|---|---|---|
| GET | `/api/review/agent/jobs[?project=&editing=1]` | queue: project, latest version, open notes (+replies), rules, next step |
| GET/POST | `/api/review/projects` | list / create (`{name, kind, brand, brief, format, footage[], version?}`) |
| GET/PATCH | `/api/review/projects/:id` | bundle (project + versions + comments) / update |
| POST | `/api/review/projects/:id/claim` | AI marks it "editing" |
| POST | `/api/review/projects/:id/versions` | new version `{file_url, mime, width, height, duration, notes, resolutions:[{comment_id, resolution}]}` |
| POST | `/api/review/projects/:id/decision` | `{version_id, decision: approve\|request_changes, note}` |
| POST | `/api/review/comments` | `{project_id, version_id, body, timecode?, timecode_end?, x?, y?, parent_id?, save_as_rule?}` |
| PATCH/DELETE | `/api/review/comments/:id` | resolve / reopen / save to playbook / delete |
| GET/POST | `/api/review/rules` | list (`?scope=&brand=&status=`) / add (the AI's become `proposed`) |
| PATCH | `/api/review/rules/:id` | approve / retire / edit |
| POST | `/api/review/upload` | Vercel Blob client-upload token (browser + CLI upload straight to Blob) |

## Notes

- Cuts should be H.264/AAC MP4 with `+faststart` (what `render.mjs` outputs) so they stream and scrub
  in every browser.
- Blob files are public URLs with random suffixes: unguessable, but anyone with the link can view.
  Fine for ad creatives; switch to private blobs + a streaming route if that changes.
- Airtable allows about 5 requests per second per base, which is plenty for a review team, and the
  client retries on 429. If the review tables get busy, give them their own base.
