import { afterEach, describe, expect, it, vi } from "vitest";
const observed = vi.hoisted(() => ({
  calls: [] as string[],
  mode: {} as Record<string, unknown>,
}));
vi.mock("expo-audio", () => ({
  setAudioModeAsync: vi.fn(async (mode) => {
    observed.mode = mode;
    observed.calls.push("speaker");
  }),
}));
vi.mock("expo-file-system", () => ({
  File: class {},
  Paths: { cache: "cache" },
}));
import { playTreeAudio } from "../apps/mobile/audio";
import type { AudioPlayer } from "expo-audio";
afterEach(() => {
  vi.useRealTimers();
  observed.calls = [];
});
function player() {
  const p = {
    isLoaded: false,
    volume: 0,
    muted: true,
    currentStatus: { error: null as string | null },
    pause: () => observed.calls.push("pause"),
    replace: () => observed.calls.push("replace"),
    seekTo: vi.fn(async () => {
      expect(p.isLoaded).toBe(true);
      observed.calls.push("seek");
    }),
    play: vi.fn(() => observed.calls.push("play")),
  };
  return p;
}
describe("native reply playback", () => {
  it("waits for a loaded reply and speaker mode before playing", async () => {
    vi.useFakeTimers();
    const p = player();
    const pending = playTreeAudio(
      p as unknown as AudioPlayer,
      "file:///reply.mp3",
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(p.play).not.toHaveBeenCalled();
    p.isLoaded = true;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(observed.calls).toEqual([
      "pause",
      "speaker",
      "replace",
      "seek",
      "play",
    ]);
    expect(observed.mode).toMatchObject({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "doNotMix",
    });
    expect(p.volume).toBe(1);
    expect(p.muted).toBe(false);
  });
  it("does not play a reply after the voice screen has closed", async () => {
    vi.useFakeTimers();
    const p = player();
    let closed = false;
    const pending = playTreeAudio(
      p as unknown as AudioPlayer,
      "file:///reply.mp3",
      () => closed,
    );
    await vi.advanceTimersByTimeAsync(100);
    closed = true;
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(p.play).not.toHaveBeenCalled();
  });
  it("reports a load failure rather than leaving the conversation stuck", async () => {
    const p = player();
    p.currentStatus.error = "Unsupported audio";
    await expect(
      playTreeAudio(p as unknown as AudioPlayer, "file:///reply.mp3"),
    ).rejects.toThrow("Unsupported audio");
    expect(p.play).not.toHaveBeenCalled();
  });
});
