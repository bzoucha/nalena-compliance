"use client";

import { useState } from "react";
import type { Pin } from "./VideoPlayer";

export function ImageViewer({
  src,
  width,
  height,
  pins = [],
  activeId,
  draftPin,
  readOnly,
  maxHeight = "72vh",
  onPlacePin,
  onPin,
}: {
  src: string;
  width?: number | null;
  height?: number | null;
  pins?: Pin[];
  activeId?: string | null;
  draftPin?: { x: number; y: number } | null;
  readOnly?: boolean;
  maxHeight?: string;
  onPlacePin?: (x: number, y: number) => void;
  onPin?: (id: string) => void;
}) {
  const [dims, setDims] = useState({ w: width || 1, h: height || 1 });
  const [showPins, setShowPins] = useState(true);

  return (
    <div className="stage">
      <div className="grid place-items-center bg-[#050d07] p-3">
        <div
          className="media-frame"
          style={{ aspectRatio: `${dims.w} / ${dims.h}`, width: `min(100%, calc(${maxHeight} * ${dims.w / dims.h}))`, cursor: readOnly ? "default" : "crosshair" }}
          onClick={(e) => {
            if (readOnly || !onPlacePin) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPlacePin((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth) setDims({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
          {showPins &&
            pins.map((p) => (
              <div
                key={p.id}
                className={`pin ${p.resolved ? "resolved" : ""} ${p.id === activeId ? "active" : ""}`}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPin?.(p.id);
                }}
              >
                <span>{p.n}</span>
              </div>
            ))}
          {draftPin && (
            <div className="pin draft" style={{ left: `${draftPin.x * 100}%`, top: `${draftPin.y * 100}%` }}>
              <span>+</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-bg-2/90 px-4 py-2 text-xs text-stone">
        <span className="num">
          {dims.w > 1 ? `${dims.w}×${dims.h}` : ""}
        </span>
        {!readOnly && <span>Click anywhere on the ad to pin a note.</span>}
        <button className={`chip ml-auto !py-0.5 ${showPins ? "chip-on" : ""}`} onClick={() => setShowPins((s) => !s)}>
          Pins
        </button>
        <a className="chip !py-0.5" href={src} target="_blank" rel="noreferrer">
          Open full size ↗
        </a>
      </div>
    </div>
  );
}
