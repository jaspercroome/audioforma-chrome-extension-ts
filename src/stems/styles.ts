import { StemRole } from "./stemAnalysis";

export type StemStyle = {
  role: StemRole;
  /** Instrument colour: in the Voices view colour says who is playing, position says what. */
  color: string;
  label: string;
};

// Demucs stem names. Horns aren't a Demucs stem: a trumpet or sax usually lands
// in "other" (or "vocals"), so "other" is treated as a melodic line.
const STYLES: Record<string, StemStyle> = {
  vocals: { role: "melody", color: "#e0962a", label: "Vocals" },
  other: { role: "melody", color: "#13968b", label: "Other (horns…)" },
  piano: { role: "chords", color: "#8753d6", label: "Piano" },
  guitar: { role: "chords", color: "#e25d35", label: "Guitar" },
  bass: { role: "bass", color: "#3450c9", label: "Bass" },
  drums: { role: "drums", color: "#5b606b", label: "Drums" },
};

const FALLBACK_COLORS = ["#c2417a", "#4f8a1f", "#b8860b", "#2f7fb8"];

export const styleFor = (stem: string, index = 0): StemStyle =>
  STYLES[stem] ?? { role: "chords", color: FALLBACK_COLORS[index % FALLBACK_COLORS.length], label: stem };

/** Display order: drums and bass underneath, melodic voices on top. */
export const STEM_ORDER = ["vocals", "other", "piano", "guitar", "bass", "drums"];
const rank = (stem: string) => {
  const i = STEM_ORDER.indexOf(stem);
  return i < 0 ? STEM_ORDER.length : i;
};
export const sortStems = (stems: string[]) => [...stems].sort((a, b) => rank(a) - rank(b));
