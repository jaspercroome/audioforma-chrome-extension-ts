import { frequencyToNote, noteAngleRad, parseNoteKey, fifthsIndex } from "../utils/notes";
import { NoteName } from "../utils/consts";

const C0 = 16.35;
const withCents = (hz: number, cents: number) => hz * Math.pow(2, cents / 1200);

describe("frequencyToNote", () => {
  it("keeps slightly flat Cs in their own octave", () => {
    for (const cents of [-49, -40, -10, 0, 10, 40, 49]) {
      const result = frequencyToNote(withCents(261.63, cents));
      expect(result.note).toBe(NoteName.C);
      expect(result.octave).toBe(4);
      expect(Math.abs(result.cents - cents)).toBeLessThanOrEqual(1);
    }
  });

  it("maps A4 and a sharp B3 correctly", () => {
    expect(frequencyToNote(440)).toMatchObject({ note: NoteName.A, octave: 4, cents: 0 });
    expect(frequencyToNote(withCents(246.94, 40))).toMatchObject({ note: NoteName.B, octave: 3 });
  });

  it("never returns more than 50 cents or an inconsistent octave from 20 Hz to 20 kHz", () => {
    const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (let i = 0; i < 480; i++) {
      const f = 20 * Math.pow(2, i / 48);
      const { note, octave, cents } = frequencyToNote(f);
      expect(Math.abs(cents)).toBeLessThanOrEqual(50);
      const semis = octave * 12 + pitchClasses.indexOf(note) + cents / 100;
      expect(Math.abs(C0 * Math.pow(2, semis / 12) - f) / f).toBeLessThan(0.001);
    }
  });
});

describe("parseNoteKey", () => {
  it("reads two-digit octaves", () => {
    expect(parseNoteKey("C#10")).toEqual({ note: NoteName["C#"], octave: 10 });
    expect(parseNoteKey("E4")).toEqual({ note: NoteName.E, octave: 4 });
  });
  it("rejects malformed keys", () => {
    expect(parseNoteKey("undefined3")).toBeNull();
    expect(parseNoteKey("H2")).toBeNull();
  });
});

describe("circle of fifths helpers", () => {
  it("places neighbours in fifths 30 degrees apart", () => {
    const step = noteAngleRad(NoteName.G) - noteAngleRad(NoteName.C);
    expect(step).toBeCloseTo(Math.PI / 6);
    expect(fifthsIndex(NoteName.F)).toBe(11);
    expect(fifthsIndex(NoteName.D)).toBe(2);
  });
});
