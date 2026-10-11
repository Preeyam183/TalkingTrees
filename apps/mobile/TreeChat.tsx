import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  SafeAreaView,
  ScrollView,
  Animated,
  StyleSheet,
  AccessibilityInfo,
  AppState,
} from "react-native";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { File, Paths } from "expo-file-system";
import * as Speech from "expo-speech";
import {
  type Tree,
  type ChatMessage,
  type ChatResponse,
  decodeBase64,
  VoiceTurnDetector,
} from "@treequest/shared";
import { api } from "./client";

export default function TreeChat({ tree }: { tree: Tree }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [draft, setDraft] = useState(""),
    [voice, setVoice] = useState(false),
    [phase, setPhase] = useState("ready"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [source, setSource] = useState(""),
    [paused, setPaused] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [facts, setFacts] = useState<string[]>([]),
    [showFacts, setShowFacts] = useState(false);
  const player = useAudioPlayer(null),
    status = useAudioPlayerStatus(player),
    recorder = useAudioRecorder({
      ...RecordingPresets.HIGH_QUALITY,
      isMeteringEnabled: true,
    });
  const recordingStatus = useAudioRecorderState(recorder, 100);
  const turn = useRef(new VoiceTurnDetector());
  const generation = useRef(0);
  const historyRef = useRef(messages);
  historyRef.current = messages;
  const scale = useRef(new Animated.Value(1)).current,
    alive = useRef(true),
    thread = useRef<ScrollView>(null),
    timeout = useRef<ReturnType<typeof setTimeout> | null>(null),
    files = useRef<File[]>([]),
    voiceOpen = useRef(voice),
    recording = useRef(false),
    locked = useRef(false);
  voiceOpen.current = voice;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      player.pause();
      if (timeout.current) clearTimeout(timeout.current);
      if (recording.current) void recorder.stop().catch(() => {});
      void Speech.stop();
      for (const file of files.current) {
        try {
          if (file.exists) file.delete();
        } catch {
          /* cache can already be removed */
        }
      }
    };
  }, []);
  useEffect(() => {
    if (status.didJustFinish) setPhase("ready");
    if (status.error) {
      setPhase("ready");
      setError(
        "Audio playback failed. Your reply is available as text. Resume to try again.",
      );
    }
  }, [status.didJustFinish, status.error]);
  useEffect(() => {
    if (voice && !paused && phase === "ready" && !busy && !error) void record();
  }, [voice, paused, phase, busy, error]);
  useEffect(() => {
    if (!recording.current || recordingStatus.metering === undefined) return;
    const action = turn.current.sample(recordingStatus.metering, Date.now());
    if (action === "send") void finish();
    if (action === "idle") void idle();
  }, [recordingStatus]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") close();
    });
    return () => subscription.remove();
  }, []);
  async function idle() {
    recording.current = false;
    if (timeout.current) clearTimeout(timeout.current);
    await recorder.stop().catch(() => {});
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
    if (!alive.current) return;
    setPaused(true);
    setPhase("ready");
  }
  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined,
      cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce || cancelled) return;
      const duration =
        phase === "speaking" || phase === "listening" ? 650 : 1800;
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.08,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 0.94,
            duration,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
    });
    return () => {
      cancelled = true;
      animation?.stop();
      scale.setValue(1);
    };
  }, [phase]);
  async function send(text = draft, spoken = voice) {
    if (!text.trim() || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setPhase("thinking");
    setDraft("");
    const history = historyRef.current.slice(-12);
    const requestGeneration = generation.current;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const answer = await api.call<ChatResponse>("tree-chat", {
        tree_id: tree.id,
        message: text,
        history,
        voice: spoken,
      });
      if (!alive.current || requestGeneration !== generation.current) return;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: answer.message },
      ]);
      setSource(
        `Feeling ${answer.personality} · checked ${new Date(answer.queried_at).toLocaleTimeString()}`,
      );
      setError("");
      setWarnings(answer.warnings);
      setFacts(answer.facts ?? []);
      if (spoken && voiceOpen.current && answer.audio_url) {
        const file = new File(Paths.cache, `tree-voice-${Date.now()}.mp3`);
        file.create();
        // Retain just the current reply rather than accumulating an entire audio session.
        for (const old of files.current) {
          try {
            if (old.exists) old.delete();
          } catch {}
        }
        files.current = [];
        file.write(
          new Uint8Array(decodeBase64(answer.audio_url.split(",")[1])),
        );
        files.current.push(file);
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        player.replace(file.uri);
        player.play();
        setPhase("speaking");
      } else if (
        spoken &&
        voiceOpen.current &&
        answer.voice_source === "simulated"
      ) {
        setPhase("speaking");
        Speech.speak(answer.message, {
          onDone: () => {
            if (alive.current) setPhase("ready");
          },
          onError: () => {
            if (alive.current) setPhase("ready");
          },
        });
      } else {
        setPhase("ready");
        if (spoken && answer.voice_source === "unavailable")
          setError(
            answer.voice_error ||
              "Tree voice is unavailable. Your reply is available as text.",
          );
      }
    } catch (e) {
      if (alive.current && requestGeneration === generation.current) {
        setError((e as Error).message);
        setPhase("ready");
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function finish() {
    if (!recording.current || locked.current) return;
    const requestGeneration = generation.current;
    recording.current = false;
    locked.current = true;
    if (timeout.current) clearTimeout(timeout.current);
    setBusy(true);
    setPhase("transcribing");
    try {
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
      if (!recorder.uri)
        throw new Error("No recording was captured. Please try again.");
      const file = new File(recorder.uri);
      if (file.size > 6 * 1024 * 1024)
        throw new Error(
          "Recording is too large. Please ask a shorter question.",
        );
      const audio_base64 = await file.base64();
      if (file.exists) file.delete();
      const result = await api.call<{ text: string }>("transcribe", {
        audio_base64,
        mime_type: "audio/m4a",
      });
      if (
        !alive.current ||
        !voiceOpen.current ||
        requestGeneration !== generation.current
      )
        return;
      locked.current = false;
      await send(result.text, true);
    } catch (e) {
      if (alive.current && requestGeneration === generation.current) {
        setError((e as Error).message);
        setPhase("ready");
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function record() {
    if (recording.current) {
      await finish();
      return;
    }
    if (locked.current) return;
    const requestGeneration = generation.current;
    locked.current = true;
    try {
      player.pause();
      await Speech.stop();
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Allow microphone access in Settings to ask with your voice.",
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      if (
        !alive.current ||
        !voiceOpen.current ||
        requestGeneration !== generation.current
      ) {
        await recorder.stop();
        return;
      }
      recorder.record();
      recording.current = true;
      turn.current.reset(Date.now());
      setError("");
      setPhase("listening");
      timeout.current = setTimeout(() => {
        if (turn.current.sample(-160, Date.now()) === "send") void finish();
        else void idle();
      }, 45000);
    } catch (e) {
      if (alive.current && requestGeneration === generation.current) {
        setError((e as Error).message);
        setPhase("ready");
      }
    } finally {
      locked.current = false;
    }
  }
  function close() {
    generation.current++;
    voiceOpen.current = false;
    setVoice(false);
    player.pause();
    void Speech.stop();
    if (timeout.current) clearTimeout(timeout.current);
    if (recording.current) {
      recording.current = false;
      void recorder
        .stop()
        .then(() => setAudioModeAsync({ allowsRecording: false }))
        .catch(() => {});
    }
    setPhase("ready");
  }
  const button = (title: string, fn: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={fn}
      style={[s.button, disabled && { opacity: 0.5 }]}
    >
      <Text style={s.buttonText}>{title}</Text>
    </Pressable>
  );
  return (
    <View style={s.chat}>
      <Text style={s.title}>Talk to {tree.name}</Text>
      <Text style={s.muted}>Ask about my sensors, caretaker, or care.</Text>
      <ScrollView
        ref={thread}
        style={s.thread}
        nestedScrollEnabled
        onContentSizeChange={() =>
          thread.current?.scrollToEnd({ animated: true })
        }
      >
        {!messages.length && (
          <Text style={s.muted}>What would you like to know about me?</Text>
        )}
        {messages.map((m, i) => (
          <View key={i} style={[s.bubble, m.role === "user" && s.userBubble]}>
            <Text style={[s.label, m.role === "user" && s.white]}>
              {m.role === "user" ? "You" : tree.name}
            </Text>
            <Text selectable style={[s.message, m.role === "user" && s.white]}>
              {m.content}
            </Text>
          </View>
        ))}
        {busy && (
          <Text accessibilityLiveRegion="polite" style={s.muted}>
            Reading the leaves…
          </Text>
        )}
      </ScrollView>
      {!!source && <Text style={s.muted}>{source}</Text>}
      {!!facts.length && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showFacts }}
            onPress={() => setShowFacts(!showFacts)}
          >
            <Text style={s.muted}>
              Readings and care {showFacts ? "−" : "+"}
            </Text>
          </Pressable>
          {showFacts &&
            facts.map((f) => (
              <Text key={f} style={s.muted}>
                {f}
              </Text>
            ))}
        </>
      )}
      {warnings.map((w) => (
        <Text key={w} style={s.muted}>
          {w}
        </Text>
      ))}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <TextInput
        accessibilityLabel={`Message ${tree.name}`}
        placeholder="Ask this tree…"
        value={draft}
        onChangeText={setDraft}
        maxLength={1000}
        multiline
        editable={!busy}
        style={s.input}
      />
      {button("Send message", () => void send(), busy || !draft.trim())}
      {button("Voice conversation", () => {
        setError("");
        setPaused(false);
        setVoice(true);
      })}
      <Modal visible={voice} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={s.voice}>
          <View style={s.top}>
            {button("Close voice", close)}
            <Text style={s.muted}>A MOMENT WITH {tree.name.toUpperCase()}</Text>
          </View>
          <View style={s.center}>
            <Animated.View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[s.orb, { transform: [{ scale }] }]}
            >
              <View style={s.orbGlow} />
            </Animated.View>
            <Text style={s.heading}>
              {phase === "listening"
                ? "I'm listening"
                : phase === "speaking"
                  ? "My story, out loud"
                  : busy
                    ? "Reading the leaves…"
                    : "Let's talk"}
            </Text>
            <Text style={s.muted}>
              Speak naturally. Pause when you’re done; I’ll reply and listen
              again.
            </Text>
            <ScrollView style={s.transcript}>
              <Text style={s.message}>{messages.at(-1)?.content}</Text>
            </ScrollView>
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            {button(
              paused || error ? "Resume conversation" : "Pause microphone",
              () => {
                if (paused || error) {
                  setError("");
                  setPaused(false);
                  setPhase("ready");
                } else {
                  setPaused(true);
                  if (recording.current) void idle();
                }
              },
              busy,
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
const s = StyleSheet.create({
  chat: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#e3e8dc",
    paddingTop: 18,
  },
  title: { fontSize: 20, fontWeight: "700", color: "#244c37" },
  muted: { fontSize: 12, color: "#667b65", lineHeight: 20 },
  thread: { maxHeight: 320 },
  bubble: {
    backgroundColor: "#eef3e8",
    borderRadius: 16,
    padding: 14,
    marginVertical: 6,
  },
  userBubble: { backgroundColor: "#365d3d", marginLeft: 30 },
  white: { color: "white" },
  label: { fontWeight: "700", fontSize: 12, color: "#244c37", marginBottom: 6 },
  message: { color: "#244c37", lineHeight: 23, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#dce4da",
    borderRadius: 12,
    padding: 14,
  },
  button: {
    backgroundColor: "#365d3d",
    borderRadius: 12,
    padding: 14,
    marginVertical: 3,
  },
  buttonText: { color: "white", textAlign: "center", fontWeight: "600" },
  error: { color: "#a34d42", lineHeight: 20 },
  voice: { flex: 1, backgroundColor: "#f8faf7" },
  top: { padding: 24, gap: 20 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 18,
  },
  orb: {
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#6b9f89",
    overflow: "hidden",
    marginBottom: 28,
    shadowColor: "#365d3d",
    shadowRadius: 28,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 8 },
  },
  orbGlow: {
    width: 145,
    height: 145,
    borderRadius: 80,
    backgroundColor: "#bde1d5",
    opacity: 0.6,
    position: "absolute",
    top: -25,
    left: -20,
  },
  heading: { fontSize: 28, fontWeight: "700", color: "#244c37" },
  transcript: { maxHeight: 170, width: "100%" },
});
