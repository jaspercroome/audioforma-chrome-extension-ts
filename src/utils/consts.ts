export const BUFFER_SIZE = 2048;

export const noteNames = {
    0: 'C',
    1: 'C#',
    2: 'D',
    3: 'D#',
    4: "E",
    5: 'F',
    6: 'F#',
    7: 'G',
    8: 'G#',
    9: 'A',
    10: 'A#',
    11: 'B',
  };
   export const noteAngles = {
    'C': 0,
    'C#': 210,
    'D': 60,
    'D#': 270,
    'E': 120,
    'F': 330,
    'F#': 180,
    'G': 30,
    'G#': 240,
    'A': 90,
    'A#': 300,
    'B': 150,
  };
   export const NOTE_FREQUENCIES = {
    'C': 16.35,
    'D': 18.35,
    'E': 20.6,
    'F': 21.83,
    'G': 24.5,
    'A': 27.5,
    'B': 30.87,
    'C#': 17.32,
    'D#': 19.45,
    'F#': 23.12,
    'G#': 25.96,
    'A#': 29.14,
  };
  
  export const octaves = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => b - a);