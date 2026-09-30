import { canPlayThrough } from "../stems/policy";

const base = { ahead: 3 };

describe("canPlayThrough", () => {
  it("starts after a short lead when separation is faster than real time", () => {
    expect(canPlayThrough({ ...base, lead: 2, remaining: 30, speed: 1.8 })).toBe(false);
    expect(canPlayThrough({ ...base, lead: 3, remaining: 30, speed: 1.8 })).toBe(true);
  });

  it("waits longer the slower separation runs", () => {
    // At half speed, 30 s left: the last 15 s can't arrive in time unless already here.
    expect(canPlayThrough({ ...base, lead: 10, remaining: 30, speed: 0.5 })).toBe(false);
    expect(canPlayThrough({ ...base, lead: 18, remaining: 30, speed: 0.5 })).toBe(true);
  });

  it("plays the rest once everything has arrived", () => {
    expect(canPlayThrough({ ...base, lead: 5, remaining: 5, speed: 0.2 })).toBe(true);
  });

  it("uses the short lead when the speed isn't known yet", () => {
    expect(canPlayThrough({ ...base, lead: 3, remaining: 200, speed: 0 })).toBe(true);
  });
});
