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
    currentStatus: { error: null as string | null, playing: false },
    pause: () => observed.calls.push("pause"),
    replace: () => observed.calls.push("replace"),
    seekTo: vi.fn(async () => {
      expect(p.isLoaded).toBe(true);
      observed.calls.push("seek");
    }),
    play: vi.fn(() => {
      observed.calls.push("play");
      p.currentStatus.playing = true;
    }),
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
    expect(observed.calls).toEqual(["pause", "speaker", "replace", "play"]);
    expect(observed.mode).toMatchObject({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: "doNotMix",
    });
    expect(p.volume).toBe(1);
    expect(p.muted).toBe(false);
    expect(p.seekTo).not.toHaveBeenCalled();
  });
  it("never accesses a released player when a pending task was cancelled", async () => {
    const released = new Proxy(
      {},
      {
        get() {
          throw new Error("Native shared object released");
        },
      },
    );
    await expect(
      playTreeAudio(released as AudioPlayer, "file:///reply.mp3", () => true),
    ).resolves.toBeUndefined();
  });
  it("checks cancellation before reading native status after a loading delay", async () => {
    vi.useFakeTimers();
    const p = player();
    let released = false;
    const native = new Proxy(p, {
      get(target, prop, receiver) {
        if (released) throw new Error("Native shared object released");
        return Reflect.get(target, prop, receiver);
      },
    });
    const pending = playTreeAudio(
      native as unknown as AudioPlayer,
      "file:///reply.mp3",
      () => released,
    );
    await vi.advanceTimersByTimeAsync(100);
    released = true;
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toBeUndefined();
    expect(p.play).not.toHaveBeenCalled();
  });
  it("reports a player that loads but never starts instead of claiming it is speaking", async () => {
    vi.useFakeTimers();
    const p = player();
    p.isLoaded = true;
    p.play.mockImplementation(() => {});
    const pending = playTreeAudio(
      p as unknown as AudioPlayer,
      "file:///reply.mp3",
    );
    const assertion = expect(pending).rejects.toThrow("did not start playing");
    await vi.advanceTimersByTimeAsync(10100);
    await assertion;
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
