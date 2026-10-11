import { setAudioModeAsync, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { decodeBase64 } from "@treequest/shared";
export const speakerMode = {
  allowsRecording: false,
  playsInSilentMode: true,
  shouldRouteThroughEarpiece: false,
  interruptionMode: "doNotMix" as const,
  shouldPlayInBackground: false,
};
export function cacheVoice(uri: string) {
  if (!uri.startsWith("data:")) return { uri, file: null };
  const encoded = uri.match(/^data:audio\/[^;,]+;base64,(.+)$/s)?.[1];
  if (!encoded)
    throw new Error("The server returned an unsupported audio reply.");
  const file = new File(
    Paths.cache,
    `tree-voice-${Date.now()}-${Math.random().toString(16).slice(2)}.mp3`,
  );
  file.create();
  const bytes = new Uint8Array(decodeBase64(encoded));
  if (!bytes.length) {
    file.delete();
    throw new Error("The voice reply is empty.");
  }
  file.write(bytes);
  return { uri: file.uri, file };
}
export async function playTreeAudio(
  player: AudioPlayer,
  uri: string,
  cancelled: () => boolean = () => false,
) {
  // Cancellation must precede every native access: hook-owned players are
  // released by Expo during unmount, including while an await is pending.
  if (cancelled()) return;
  player.pause();
  await setAudioModeAsync(speakerMode);
  if (cancelled()) return;
  player.volume = 1;
  player.muted = false;
  player.replace({ uri });
  const deadline = Date.now() + 15000;
  while (true) {
    if (cancelled()) return;
    const error = player.currentStatus.error;
    if (error) throw new Error(`Audio could not load: ${error}`);
    if (player.isLoaded) break;
    if (Date.now() >= deadline)
      throw new Error(
        "The reply could not load. Tap Replay reply to try again.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (cancelled()) return;
  // replace() creates a new item at zero. A redundant native seek can hang
  // while iOS transitions from the microphone session to playback.
  player.play();
  const startDeadline = Date.now() + 10000;
  while (true) {
    if (cancelled()) return;
    const status = player.currentStatus;
    if (status.error) throw new Error(`Audio playback failed: ${status.error}`);
    if (status.playing || status.didJustFinish) return;
    if (Date.now() >= startDeadline) {
      player.pause();
      throw new Error(
        "The reply did not start playing. Tap Replay reply to retry.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
