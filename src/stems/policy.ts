/**
 * When a stream of stems can play without stopping.
 *
 * `lead` is how many seconds are ready past the playhead, `remaining` how
 * many are left in the song, `speed` how fast audio arrives (audio seconds
 * per second; 0 if unknown). Faster than real time, a short lead is enough.
 * Slower, playback would catch up, so wait until the rest can arrive in the
 * time it takes to play: lead >= remaining * (1 - speed), plus a margin.
 */
export const canPlayThrough = (options: {
  lead: number;
  remaining: number;
  speed: number;
  ahead: number;
}) => {
  const { lead, remaining, speed, ahead } = options;
  if (lead >= remaining - 0.05) return true; // everything left is already here
  if (speed >= 1.05 || speed === 0) return lead >= Math.min(ahead, remaining);
  return lead >= remaining * (1 - speed) + ahead;
};
