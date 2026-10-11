import { useEffect, useRef, useState } from "react";
import { Mic, Send, X } from "lucide-react";
import {
  type Tree,
  type ChatMessage,
  type ChatResponse,
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
  const [facts, setFacts] = useState<string[]>([]);
  const voiceOpen = useRef(voice);
  voiceOpen.current = voice;
  const startingMicrophone = useRef(false);
  const lock = useRef(false),
    generation = useRef(0);
  const historyRef = useRef(messages);
  historyRef.current = messages;
  const monitor = useRef<ReturnType<typeof setInterval> | null>(null);
  const context = useRef<AudioContext | null>(null);
  const turn = useRef(new VoiceTurnDetector());
  function stopMonitor() {
    if (monitor.current) clearInterval(monitor.current);
    monitor.current = null;
    void context.current?.close().catch(() => {});
    context.current = null;
  }
  function close() {
    generation.current++;
    voiceOpen.current = false;
    setVoice(false);
    stopMonitor();
    audio.current?.pause();
    window.speechSynthesis?.cancel();
    if (recorder.current?.state === "recording") {
      recorder.current.onstop = null;
      recorder.current.stop();
    }
    stream.current?.getTracks().forEach((t) => t.stop());
    if (timer.current) clearTimeout(timer.current);
    setPhase("ready");
  }
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    audio = useRef<HTMLAudioElement | null>(null),
    mounted = useRef(true),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    thread = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      stopMonitor();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    thread.current?.scrollTo({
      top: thread.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
  useEffect(() => {
    if (voice && !paused && phase === "ready" && !busy && !error) void record();
  }, [voice, paused, phase, busy, error]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) close();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  async function send(text = draft, spoken = voice) {
    if (!text.trim() || lock.current) return;
    lock.current = true;
    const requestGeneration = generation.current;
    const history = historyRef.current.slice(-12);
    setDraft("");
    setError("");
    setBusy(true);
    setPhase("thinking");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    try {
      const r = await api.call<ChatResponse>("tree-chat", {
        tree_id: tree.id,
        message: text,
        history,
        voice: spoken,
      });
      if (!mounted.current || requestGeneration !== generation.current) return;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: r.message },
      ]);
      setSource(
        `Feeling ${r.personality} · checked ${new Date(r.queried_at).toLocaleTimeString()}`,
      );
      setError("");
      setWarnings(r.warnings);
      setFacts(r.facts ?? []);
      if (spoken && voiceOpen.current && r.audio_url) {
        setPhase("speaking");
        audio.current = new Audio(r.audio_url);
        audio.current.onended = () => {
          if (
            mounted.current &&
            voiceOpen.current &&
            requestGeneration === generation.current
          )
            setPhase("ready");
        };
        audio.current.onerror = () => {
          setPhase("ready");
          setError("Audio playback failed. Your reply is available above.");
        };
        await audio.current.play();
      } else if (
        spoken &&
        voiceOpen.current &&
        r.voice_source === "simulated" &&
        "speechSynthesis" in window
      ) {
        setPhase("speaking");
        const utterance = new SpeechSynthesisUtterance(r.message);
        utterance.onend = () => setPhase("ready");
        utterance.onerror = () => setPhase("ready");
        speechSynthesis.speak(utterance);
      } else {
        setPhase("ready");
        if (spoken)
          setError(
            r.voice_error ||
              "Tree voice is unavailable. You can read the reply above.",
          );
      }
    } catch (e) {
      if (mounted.current && requestGeneration === generation.current) {
        setError((e as Error).message);
        setPhase("ready");
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function record() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    if (startingMicrophone.current || lock.current) return;
    const requestGeneration = generation.current;
    startingMicrophone.current = true;
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Microphone recording requires a supported browser and HTTPS or localhost.",
        );
      audio.current?.pause();
      window.speechSynthesis?.cancel();
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (
        !mounted.current ||
        !voiceOpen.current ||
        requestGeneration !== generation.current
      ) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mime = ["audio/webm", "audio/mp4", "audio/ogg"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder.current = r;
      const chunks: BlobPart[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        if (timer.current) clearTimeout(timer.current);
        stopMonitor();
        media.getTracks().forEach((t) => t.stop());
        if (
          !mounted.current ||
          !voiceOpen.current ||
          requestGeneration !== generation.current
        )
          return;
        lock.current = true;
        setBusy(true);
        setPhase("transcribing");
        try {
          const blob = new Blob(chunks, { type: r.mimeType });
          if (blob.size > 6 * 1024 * 1024)
            throw new Error("Recording is too large. Try a shorter question.");
          const encoded = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(",")[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const result = await api.call<{ text: string }>("transcribe", {
            audio_base64: encoded,
            mime_type: r.mimeType.split(";")[0],
          });
          if (
            !mounted.current ||
            !voiceOpen.current ||
            requestGeneration !== generation.current
          ) {
            lock.current = false;
            if (mounted.current) setBusy(false);
            return;
          }
          // Send directly after transcription; the recording button locks out other requests.
          setBusy(false);
          lock.current = false;
          if (voiceOpen.current) await send(result.text, true);
          else setPhase("ready");
        } catch (e) {
          if (mounted.current && requestGeneration === generation.current) {
            setError((e as Error).message);
            setPhase("ready");
          }
        } finally {
          lock.current = false;
          if (mounted.current) setBusy(false);
        }
      };
      setError("");
      setPhase("listening");
      const ctx = new AudioContext();
      context.current = ctx;
      await ctx.resume();
      const input = ctx.createMediaStreamSource(media),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      input.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      turn.current.reset(Date.now());
      r.start();
      monitor.current = setInterval(() => {
        if (r.state !== "recording") return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, v) => sum + v * v, 0) / samples.length,
        );
        const action = turn.current.sample(
          20 * Math.log10(Math.max(rms, 1e-8)),
          Date.now(),
        );
        if (action === "send") r.stop();
        else if (action === "idle") {
          r.onstop = null;
          r.stop();
          stopMonitor();
          media.getTracks().forEach((t) => t.stop());
          setPaused(true);
          setPhase("ready");
        }
      }, 100);
      timer.current = setTimeout(() => {
        if (r.state !== "recording") return;
        if (turn.current.sample(-160, Date.now()) === "send") r.stop();
        else {
          r.onstop = null;
          r.stop();
          stopMonitor();
          media.getTracks().forEach((t) => t.stop());
          setPaused(true);
          setPhase("ready");
        }
      }, 45000);
    } catch (e) {
      stopMonitor();
      stream.current?.getTracks().forEach((t) => t.stop());
      if (mounted.current && requestGeneration === generation.current) {
        setError((e as Error).message);
        setPhase("ready");
      }
    } finally {
      startingMicrophone.current = false;
    }
  }
  return (
    <section className="tree-chat" aria-label={`Chat with ${tree.name}`}>
      <h3>Talk to {tree.name}</h3>
      <p className="muted">
        Ask about my sensors, caretaker, or care. Historical readings are
        available to my caretaker.
      </p>
      <div className="chat-thread" ref={thread} role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="chat-empty">What would you like to know about me?</p>
        )}
        {messages.map((m, i) => (
          <div className={`chat-bubble ${m.role}`} key={i}>
            <small>{m.role === "user" ? "You" : tree.name}</small>
            <p>{m.content}</p>
          </div>
        ))}
        {busy && (
          <p role="status">
            {phase === "transcribing"
              ? "Listening to your question…"
              : "Reading the leaves…"}
          </p>
        )}
      </div>
      {source && <small>{source}</small>}
      {!!facts.length && (
        <details className="chat-facts">
          <summary>Readings and care</summary>
          {facts.map((f) => (
            <p className="muted" key={f}>
              {f}
            </p>
          ))}
        </details>
      )}
      {warnings.map((w) => (
        <p className="muted" key={w}>
          {w}
        </p>
      ))}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          aria-label={`Message ${tree.name}`}
          placeholder="Ask this tree…"
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy || phase === "listening"}
        />
        <button
          className="primary"
          aria-label="Send message"
          disabled={busy || !draft.trim() || phase === "listening"}
        >
          <Send size={18} />
        </button>
      </form>
      <button
        className="secondary full"
        onClick={() => {
          setError("");
          setPaused(false);
          setVoice(true);
        }}
      >
        <Mic size={17} /> Voice conversation
      </button>
      {voice && (
        <div className="modal-backdrop">
          <section
            className="voice-screen"
            role="dialog"
            aria-modal="true"
            aria-label="Tree voice conversation"
          >
            <button
              className="icon voice-close"
              aria-label="Close voice"
              onClick={close}
            >
              <X />
            </button>
            <span className="eyebrow">
              A MOMENT WITH {tree.name.toUpperCase()}
            </span>
            <div className={`voice-orb ${phase}`} aria-hidden="true" />
            <h2>
              {phase === "listening"
                ? "I'm listening"
                : phase === "speaking"
                  ? "My story, out loud"
                  : busy
                    ? "Reading the leaves…"
                    : "Let's talk"}
            </h2>
            <p>
              Speak naturally. Pause when you’re done; I’ll reply and listen
              again.
            </p>
            {messages.at(-1) && (
              <p className="voice-transcript">{messages.at(-1)?.content}</p>
            )}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                if (paused || error) {
                  setError("");
                  setPaused(false);
                  setPhase("ready");
                } else {
                  setPaused(true);
                  if (recorder.current?.state === "recording") {
                    recorder.current.onstop = null;
                    recorder.current.stop();
                    stopMonitor();
                    stream.current?.getTracks().forEach((t) => t.stop());
                    setPhase("ready");
                  }
                }
              }}
            >
              <Mic size={20} />
              {paused || error ? "Resume conversation" : "Pause microphone"}
            </button>
          </section>
        </div>
      )}
    </section>
  );
}
