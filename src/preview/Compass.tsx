import React from "react";
import { noteNames } from "../utils/consts";
import { fifthsIndex } from "../utils/notes";
import { NOTE_COLORS_HEX } from "../utils/noteColors";
import { Vec2 } from "../utils/orbAnalysis";

const SIZE = 148;
const C = SIZE / 2;
const R = 46;
const LABEL_R = 60;

const NOTES_BY_FIFTHS = Object.values(noteNames)
  .map((note, pc) => ({ note, pc, f: fifthsIndex(note) }))
  .sort((a, b) => a.f - b.f);

/** SVG position for a point on the circle of fifths: C at 12 o'clock, sharpward clockwise. */
const toSvg = (angleRad: number, radius: number) => ({
  x: C + radius * Math.cos(angleRad - Math.PI / 2),
  y: C + radius * Math.sin(angleRad - Math.PI / 2),
});

const polar = (v: Vec2) => ({ angle: Math.atan2(v.y, v.x), length: Math.min(1, Math.hypot(v.x, v.y)) });

type CompassProps = { here: Vec2; home: Vec2; color: string };

/** The orb's "feeling" layer as an instrument: where the harmony is, and where home is. */
export const Compass = ({ here, home, color }: CompassProps) => {
  const h = polar(here);
  const m = polar(home);
  const herePt = toSvg(h.angle, R * h.length);
  const homePt = toSvg(m.angle, R * m.length);
  return (
    <svg
      className="compass"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label="Circle of fifths showing the current harmonic centre and home"
    >
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--hairline-strong)" strokeWidth="1" />
      <circle cx={C} cy={C} r={R * 0.5} fill="none" stroke="var(--hairline)" strokeWidth="1" />
      <line x1={C - 4} y1={C} x2={C + 4} y2={C} stroke="var(--muted)" strokeWidth="1" />
      <line x1={C} y1={C - 4} x2={C} y2={C + 4} stroke="var(--muted)" strokeWidth="1" />
      {NOTES_BY_FIFTHS.map(({ note, pc, f }) => {
        const angle = (f * Math.PI) / 6;
        const dot = toSvg(angle, R);
        const label = toSvg(angle, LABEL_R);
        return (
          <g key={note}>
            <circle cx={dot.x} cy={dot.y} r={3.4} fill={NOTE_COLORS_HEX[pc]} />
            <text x={label.x} y={label.y} className="compass-label" textAnchor="middle" dominantBaseline="central">
              {note}
            </text>
          </g>
        );
      })}
      <line x1={homePt.x} y1={homePt.y} x2={herePt.x} y2={herePt.y} stroke="var(--ink)" strokeOpacity="0.35" strokeWidth="1" />
      <circle cx={homePt.x} cy={homePt.y} r={5.5} fill="none" stroke="var(--ink)" strokeWidth="1.4" />
      <circle cx={herePt.x} cy={herePt.y} r={4.6} fill={color} stroke="var(--ink)" strokeWidth="1" />
    </svg>
  );
};
