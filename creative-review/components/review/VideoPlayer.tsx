"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { formatSmpte, formatTimecode } from "@/lib/review/time";

export interface PlayerHandle {
  seek(t: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  time(): number;
  duration(): number;
  step(frames: number): void;
  nudge(seconds: number): void;
  /** Used by compare mode: keep this player locked to another one. */
  follow(t: number, playing: boolean): void;
  toggleMute(): void;
  fullscreen(): void;
}

export interface Marker {
  id: string;
  n: number;
  t: number;
  tEnd: number | null;
  resolved: boolean;
}

export interface Pin {
  id: string;
  n: number;
  x: number;
  y: number;
  t: number | null;
  resolved: boolean;
}

interface Props {
  ref?: React.Ref<PlayerHandle>;
  src: string;
  fps?: number;
  width?: number | null;
  height?: number | null;
  markers?: Marker[];
  pins?: Pin[];
  activeId?: string | null;
  draftPin?: { x: number; y: number } | null;
  draftRange?: { t: number; tEnd: number | null } | null;
  pinMode?: boolean;
  minimal?: boolean;
  maxHeight?: string;
  onPlacePin?: (x: number, y: number) => void;
  onMarker?: (id: string) => void;
  onTick?: (t: number, playing: boolean) => void;
}

const SPEEDS = [0.5, 1, 1.5, 2];

export function VideoPlayer({
  ref,
  src,
  fps = 30,
  width,
  height,
  markers = [],
  pins = [],
  activeId,
  draftPin,
  draftRange,
  pinMode,
  minimal,
  maxHeight = "68vh",
  onPlacePin,
  onMarker,
  onTick,
}: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number }>({ w: width || 16, h: height || 9 });
  const frame = 1 / fps;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const seek = useCallback((to: number) => {
    const v = video.current;
    if (!v) return;
    const d = v.duration || 0;
    v.currentTime = Math.max(0, d ? Math.min(d - 0.001, to) : to);
    setT(v.currentTime);
  }, []);

  const api = useMemo<PlayerHandle>(
    () => ({
      seek,
      play: () => void video.current?.play().catch(() => undefined),
      pause: () => video.current?.pause(),
      toggle: () => {
        const v = video.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => undefined);
        else v.pause();
      },
      time: () => video.current?.currentTime ?? 0,
      duration: () => video.current?.duration ?? 0,
      step: (frames) => {
        const v = video.current;
        if (!v) return;
        v.pause();
        // Land on frame boundaries so the readout matches what you see.
        const cur = Math.round(v.currentTime * fps);
        seek((cur + frames) / fps + frame / 2);
      },
      nudge: (s) => seek((video.current?.currentTime ?? 0) + s),
      follow: (to, shouldPlay) => {
        const v = video.current;
        if (!v) return;
        if (Math.abs(v.currentTime - to) > 0.15) v.currentTime = to;
        if (shouldPlay && v.paused) void v.play().catch(() => undefined);
        if (!shouldPlay && !v.paused) v.pause();
      },
      toggleMute: () => setMuted((m) => !m),
      fullscreen: () => {
        const el = shell.current;
        if (!el) return;
        if (document.fullscreenElement) void document.exitFullscreen();
        else void el.requestFullscreen?.();
      },
    }),
    [seek, fps, frame],
  );
  useImperativeHandle(ref, () => api, [api]);

  // Smooth playhead while playing; timeupdate alone is ~4 Hz.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loopFn = () => {
      const v = video.current;
      if (v) {
        setT(v.currentTime);
        onTickRef.current?.(v.currentTime, true);
      }
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (video.current) video.current.muted = muted;
  }, [muted]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  // Loop a range comment (or the whole cut) when loop is on.
  const activeMarker = markers.find((m) => m.id === activeId);
  const loopRange = loop && activeMarker?.tEnd != null ? { a: activeMarker.t, b: activeMarker.tEnd } : null;
  useEffect(() => {
    if (loopRange && playing && t >= loopRange.b) seek(loopRange.a);
  }, [t, loopRange, playing, seek]);

  const pct = (x: number) => (dur ? `${(x / dur) * 100}%` : "0%");
  const visiblePins = pins.filter((p) => p.id === activeId || p.t == null || Math.abs(p.t - t) < 0.75);

  function clickStage(e: React.MouseEvent<HTMLDivElement>) {
    if (minimal) return;
    if (pinMode && onPlacePin) {
      const r = e.currentTarget.getBoundingClientRect();
      onPlacePin((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      return;
    }
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  }

  return (
    <div ref={shell} className="stage flex flex-col">
      <div className="grid place-items-center bg-black p-0">
        <div
          className="media-frame"
          style={{ aspectRatio: `${dims.w} / ${dims.h}`, width: `min(100%, calc(${maxHeight} * ${dims.w / dims.h}))`, cursor: pinMode ? "crosshair" : "pointer" }}
          onClick={clickStage}
        >
          <video
            ref={video}
            src={src}
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDur(v.duration);
              if (v.videoWidth && v.videoHeight) setDims({ w: v.videoWidth, h: v.videoHeight });
            }}
            onDurationChange={(e) => setDur(e.currentTarget.duration)}
            onTimeUpdate={(e) => {
              setT(e.currentTarget.currentTime);
              onTickRef.current?.(e.currentTarget.currentTime, !e.currentTarget.paused);
            }}
            onSeeked={(e) => onTickRef.current?.(e.currentTarget.currentTime, !e.currentTarget.paused)}
            onPlay={() => setPlaying(true)}
            onPause={(e) => {
              setPlaying(false);
              onTickRef.current?.(e.currentTarget.currentTime, false);
            }}
            onEnded={() => {
              if (loop && !loopRange) seek(0);
            }}
            onProgress={(e) => {
              const v = e.currentTarget;
              if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
            }}
          />
          {visiblePins.map((p) => (
            <div
              key={p.id}
              className={`pin ${p.resolved ? "resolved" : ""} ${p.id === activeId ? "active" : ""}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onClick={(e) => {
                e.stopPropagation();
                onMarker?.(p.id);
              }}
              title={`#${p.n}`}
            >
              <span>{p.n}</span>
            </div>
          ))}
          {draftPin && (
            <div className="pin draft" style={{ left: `${draftPin.x * 100}%`, top: `${draftPin.y * 100}%` }}>
              <span>+</span>
            </div>
          )}
          {pinMode && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-gold">
              Click the frame to drop a pin
            </div>
          )}
        </div>
      </div>

      {!minimal && (
        <div className="border-t border-line bg-bg-2/90 px-4 pb-3 pt-2">
          <Timeline
            t={t}
            dur={dur}
            buffered={buffered}
            markers={markers}
            activeId={activeId}
            draftRange={draftRange}
            onSeek={seek}
            onMarker={onMarker}
            pct={pct}
          />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button className="icon-btn !h-9 !w-9 !text-cream" aria-label={playing ? "Pause" : "Play"} onClick={() => api.toggle()}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button className="icon-btn" title="Back 1 frame (←)" aria-label="Back one frame" onClick={() => api.step(-1)}>
              ⟨
            </button>
            <button className="icon-btn" title="Forward 1 frame (→)" aria-label="Forward one frame" onClick={() => api.step(1)}>
              ⟩
            </button>
            <span className="num text-sm text-cream">{formatSmpte(t, fps)}</span>
            <span className="num text-xs text-stone">/ {formatTimecode(dur)}</span>
            <div className="ml-auto flex items-center gap-1">
              <button className={`chip !py-0.5 ${loop ? "chip-on" : ""}`} onClick={() => setLoop((l) => !l)} title="Loop (range comments loop their range)">
                ⟲ Loop
              </button>
              <select className="chip !py-0.5" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
              <button className="icon-btn" aria-label={muted ? "Unmute" : "Mute"} title="Mute (M)" onClick={() => setMuted((m) => !m)}>
                {muted ? "🔇" : "🔊"}
              </button>
              <button className="icon-btn" aria-label="Fullscreen" title="Fullscreen (F)" onClick={() => api.fullscreen()}>
                ⛶
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Timeline({
  t,
  dur,
  buffered,
  markers,
  activeId,
  draftRange,
  onSeek,
  onMarker,
  pct,
}: {
  t: number;
  dur: number;
  buffered: number;
  markers: Marker[];
  activeId?: string | null;
  draftRange?: { t: number; tEnd: number | null } | null;
  onSeek: (t: number) => void;
  onMarker?: (id: string) => void;
  pct: (x: number) => string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const dragging = useRef(false);

  const timeAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur;
  };

  const active = markers.find((m) => m.id === activeId);
  return (
    <div
      ref={bar}
      className="timeline"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.marker) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        setHover(timeAt(e.clientX));
        if (dragging.current) onSeek(timeAt(e.clientX));
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerLeave={() => setHover(null)}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={dur}
      aria-valuenow={t}
    >
      <div className="track" />
      <div className="buffered" style={{ width: pct(buffered) }} />
      <div className="played" style={{ width: pct(t) }} />
      {active?.tEnd != null && <div className="range" style={{ left: pct(active.t), width: pct(active.tEnd - active.t) }} />}
      {draftRange && draftRange.tEnd != null && (
        <div className="range" style={{ left: pct(draftRange.t), width: pct(draftRange.tEnd - draftRange.t), borderStyle: "dashed" }} />
      )}
      <div className="head" style={{ left: pct(t) }} />
      {markers.map((m) => (
        <button
          key={m.id}
          data-marker="1"
          className={`marker ${m.resolved ? "resolved" : ""} ${m.id === activeId ? "active" : ""}`}
          style={{ left: pct(m.t) }}
          title={`#${m.n} · ${formatTimecode(m.t)}`}
          aria-label={`Comment ${m.n} at ${formatTimecode(m.t)}`}
          onClick={(e) => {
            e.stopPropagation();
            onMarker?.(m.id);
          }}
        />
      ))}
      {hover != null && dur > 0 && (
        <div className="hover-time" style={{ left: pct(hover) }}>
          {formatTimecode(hover)}
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />
    </svg>
  );
}
