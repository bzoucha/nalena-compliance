# edit.json — the timeline the renderer builds from

`creative-review/scripts/render.mjs` turns this file into an H.264/AAC MP4 (`+faststart`, so it
streams in the review player). Paths are relative to `edit.json`.

```jsonc
{
  "output": { "file": "out/v2.mp4", "width": 1080, "height": 1920, "fps": 30, "crf": 20 },

  // Laid end to end in order. Video: in/out are SOURCE seconds. Stills: duration.
  "clips": [
    { "src": "footage/talking_head.mp4", "in": 3.2, "out": 5.9, "label": "hook A" },
    { "src": "footage/broll_pills.mov", "in": 0, "out": 1.4, "volume": 0, "speed": 1.25, "label": "problem" },
    { "src": "footage/pack.png", "duration": 2.0, "fit": "contain", "bg": "0x0F2A14", "zoom": 1.08, "label": "product" }
  ],

  // Hooks, supers, disclaimers. y is 0–1 from the top (centre of the text block).
  "text": [
    { "text": "Stop guessing.\nIt's not you — it's the pill.", "start": 0, "end": 2.2, "y": 0.2, "size": 68 },
    { "text": "Results may vary. …", "start": 6.0, "end": 10.2, "y": 0.93, "size": 22, "box": false }
  ],

  // Burned-in captions (ASS). Write one entry per caption chunk (2–5 words reads best).
  "captions": [ { "start": 0.2, "end": 1.1, "text": "I tried everything" } ],
  "captionStyle": { "size": 64, "y": 0.70, "font": "Inter", "color": "#FFFFFF", "outline": 6, "uppercase": true },

  "overlays": [ { "src": "assets/logo.png", "start": 0, "end": 999, "x": 0.06, "y": 0.04, "width": 0.22 } ],
  "music": { "src": "music/bed.mp3", "volume": 0.16, "duck": true, "fadeOut": 1.0 },
  "voiceover": { "src": "vo/vo.wav", "volume": 1, "start": 0 }
}
```

| field | notes |
|---|---|
| `fit` | `cover` (default, fills the frame, crops) or `contain` (letterbox on `bg`) |
| `speed` | 0.5–2; audio is time-stretched |
| `volume` | per clip; 0 mutes b-roll |
| `zoom` | stills only: slow push-in to this scale over the clip |
| `text.box` | default true (dark box behind text); `false` = outlined text |
| `music.duck` | default true: music dips under clip audio / VO automatically |

## Commands

```bash
node creative-review/scripts/render.mjs timeline edit.json      # where every clip lands in the cut
node creative-review/scripts/render.mjs locate edit.json 12.4   # what's on screen at 00:12.4
node creative-review/scripts/render.mjs render edit.json        # → out file + out.timeline.json
node creative-review/scripts/render.mjs sheet out/v2.mp4 3.1 12.4   # QA frames at those times
```

## Craft defaults (until the playbook says otherwise)

- **Hook**: first frame is already the hook — no logos, no fade-in. Text hook on screen by 0.3 s.
- **Pacing**: talking-head cuts every 2–4 s; b-roll 0.8–1.5 s. Remove breaths and silences > 0.25 s
  (find them with `ffmpeg -i in.mp4 -af silencedetect=noise=-35dB:d=0.25 -f null -`).
- **Safe zones (9:16 Reels/TikTok)**: keep text out of the top 12% and bottom 22%; captions around
  y = 0.62–0.72. Never over a face: if the face is centred, move captions above or below it.
- **Captions**: 2–5 words per chunk, change on natural phrase breaks, timed to the audio. If no
  transcript exists, transcribe (`whisper`/`faster-whisper` if installed) or time the brief's script
  against the audio by listening for silences.
- **Audio**: VO/dialogue around -14 LUFS integrated
  (`ffmpeg -i out.mp4 -af loudnorm=print_format=summary -f null -`). Music 12–18% under speech.
- **End card**: CTA on screen for at least the last 1.5 s.
- **Disclaimers**: as the brand requires (see SKILL.md §5), readable size, long enough to read.

## Applying a note — worked example

Note: `@00:03.1–00:03.8  Colour bars segment drags — cut it in half.`

```
$ render.mjs locate edit.json 3.1
@00:03.10 → clips[1] "problem"  footage/b.mp4 @ 1.400s  (clip spans 00:02.50–00:03.83 of the cut)
```

clips[1] is `in 0.5 → out 2.5` at speed 1.5 (1.33 s on screen). Halve it: `out` → 1.5 (0.67 s).
Everything after moves 0.66 s earlier, so say so in the resolution.
