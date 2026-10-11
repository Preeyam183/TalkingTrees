import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, create } from "react-test-renderer";

const native = vi.hoisted(() => ({
  released: false,
  recorderReleased: false,
  meter: { metering: -70, durationMillis: 0 },
  status: {
    didJustFinish: false,
    error: null as string | null,
    playing: false,
  },
  api: vi.fn(),
  record: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
}));
vi.mock("../apps/mobile/node_modules/react-native/index.js", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: "Pressable",
  Modal: "Modal",
  SafeAreaView: "SafeAreaView",
  ScrollView: "ScrollView",
  StyleSheet: { create: (value: unknown) => value },
  Platform: { OS: "ios" },
  AccessibilityInfo: { isReduceMotionEnabled: async () => true },
  AppState: { addEventListener: () => ({ remove() {} }) },
  Animated: {
    View: "AnimatedView",
    Value: class {
      setValue() {}
    },
  },
}));
// Render with the same React instance as the test renderer; production keeps
// Expo's pinned React through its Metro resolver.
vi.mock(
  "../apps/mobile/node_modules/react/index.js",
  async () => await import("react"),
);
vi.mock("../apps/mobile/ActionTile", () => ({ ActionTile: "ActionTile" }));
vi.mock("../apps/mobile/client", () => ({ api: { call: native.api } }));
vi.mock("expo-speech", () => ({ stop: async () => {}, speak: vi.fn() }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache/" },
  File: class {
    uri = "file:///audio.m4a";
    exists = true;
    size = 1024;
    create() {}
    write() {}
    delete() {
      this.exists = false;
    }
    async base64() {
      return "AQIDBA==";
    }
  },
}));
vi.mock("expo-audio", async () => {
  const { useEffect, useState } = await import("react");
  function checkPlayer() {
    if (native.released) throw new Error("Native shared object released");
  }
  function checkRecorder() {
    if (native.recorderReleased)
      throw new Error("Recorder shared object released");
  }
  return {
    setAudioModeAsync: async () => {},
    requestRecordingPermissionsAsync: async () => ({ granted: true }),
    RecordingPresets: { HIGH_QUALITY: {} },
    useAudioPlayer() {
      const [player] = useState(() => {
        native.released = false;
        return {
          get isLoaded() {
            checkPlayer();
            return true;
          },
          get currentStatus() {
            checkPlayer();
            return native.status;
          },
          pause() {
            checkPlayer();
            native.pause();
            native.status.playing = false;
          },
          replace() {
            checkPlayer();
            native.status.didJustFinish = false;
          },
          play() {
            checkPlayer();
            native.play();
            native.status.playing = true;
          },
          volume: 0,
          muted: true,
        };
      });
      // Match Expo's passive disposal, which runs before later passive cleanups.
      useEffect(
        () => () => {
          native.released = true;
        },
        [],
      );
      return player;
    },
    useAudioPlayerStatus: () => ({ ...native.status }),
    useAudioRecorder() {
      const [recorder] = useState(() => {
        native.recorderReleased = false;
        return {
          get uri() {
            checkRecorder();
            return "file:///recording.m4a";
          },
          async prepareToRecordAsync() {
            checkRecorder();
          },
          record() {
            checkRecorder();
            native.record();
          },
          async stop() {
            checkRecorder();
          },
        };
      });
      useEffect(
        () => () => {
          native.recorderReleased = true;
        },
        [],
      );
      return recorder;
    },
    useAudioRecorderState: () => ({ ...native.meter }),
  };
});
import TreeChat from "../apps/mobile/TreeChat";
import type { Tree } from "../packages/shared/src/index";
const tree = { id: "test-tree", name: "Maple" } as Tree;
let screen: ReturnType<typeof create> | undefined;
async function render() {
  await act(async () => {
    screen = create(React.createElement(TreeChat, { tree }));
  });
}
async function update() {
  await act(async () => {
    screen!.update(React.createElement(TreeChat, { tree }));
  });
}
async function button(title: string) {
  await act(async () => {
    screen!.root
      .findAll((n) => n.type === "ActionTile" && n.props.title === title)[0]
      .props.onPress();
  });
}
async function meter(db: number, time: number) {
  vi.setSystemTime(time);
  native.meter = { metering: db, durationMillis: time };
  await update();
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(0);
  native.status = { playing: false, didJustFinish: false, error: null };
  native.meter = { metering: -70, durationMillis: 0 };
  native.record.mockClear();
  native.play.mockClear();
  native.pause.mockClear();
  native.api.mockReset().mockImplementation(async (route: string) =>
    route === "transcribe"
      ? { text: "How are you today?" }
      : {
          message: "I'm feeling leafy!",
          personality: "warm",
          queried_at: new Date().toISOString(),
          warnings: [],
          facts: [],
          audio_url: "data:audio/mpeg;base64,AQIDBA==",
          voice_source: "elevenlabs",
        },
  );
});
afterEach(async () => {
  if (screen) await act(async () => screen!.unmount());
  screen = undefined;
  vi.useRealTimers();
});
describe("native voice conversation lifecycle", () => {
  it("submits speech automatically, displays the answer, plays audio, and listens again", async () => {
    await render();
    await button("Voice conversation");
    expect(native.record).toHaveBeenCalledTimes(1);
    for (let t = 100; t <= 500; t += 100) await meter(-48, t);
    for (let t = 600; t <= 1600; t += 100) await meter(-24, t);
    await meter(-48, 3000);
    expect(native.api).toHaveBeenCalledWith(
      "transcribe",
      expect.objectContaining({ mime_type: "audio/m4a" }),
    );
    expect(native.api).toHaveBeenCalledWith(
      "tree-chat",
      expect.objectContaining({ message: "How are you today?", voice: true }),
    );
    expect(JSON.stringify(screen!.toJSON())).toContain("I'm feeling leafy!");
    expect(native.play).toHaveBeenCalledTimes(1);
    native.status = { playing: false, didJustFinish: true, error: null };
    await update();
    expect(native.record).toHaveBeenCalledTimes(2);
  });
  it("unmounts an active recording without calling released native objects", async () => {
    await render();
    await button("Voice conversation");
    await act(async () => screen!.unmount());
    screen = undefined;
    expect(native.released).toBe(true);
    expect(native.recorderReleased).toBe(true);
  });
  it("does not play a delayed response after closing and unmounting", async () => {
    let reply!: (value: unknown) => void;
    native.api.mockImplementation(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    await render();
    await button("Voice conversation");
    await button("Send voice turn");
    await act(async () => screen!.unmount());
    screen = undefined;
    await act(async () => reply({ text: "How are you?" }));
    expect(native.api).toHaveBeenCalledTimes(1);
    expect(native.play).not.toHaveBeenCalled();
  });
  it("submits after 20 seconds even if native metering is missing", async () => {
    await render();
    await button("Voice conversation");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(native.api).toHaveBeenCalledWith("transcribe", expect.anything());
    expect(native.play).toHaveBeenCalledTimes(1);
  });
});
