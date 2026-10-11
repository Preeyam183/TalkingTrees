/** Silence ends a turn only after speech; background noise and empty turns are ignored. */
export class VoiceTurnDetector {
  constructor(
    private readonly minimumSpeechDb = -48,
    private readonly calibrationMs = 0,
    private readonly maximumTurnMs = 45000,
  ) {}
  private calibration: number[] = [];
  private started = 0;
  private lastSpeech = 0;
  private speechMs = 0;
  private previous = 0;
  private floor = -60;
  reset(now: number) {
    this.started = this.previous = now;
    this.lastSpeech = this.speechMs = 0;
    this.floor = this.minimumSpeechDb - 12;
    this.calibration = [];
  }
  sample(db: number, now: number): "continue" | "send" | "idle" {
    if (!Number.isFinite(db)) return "continue";
    const elapsed = Math.min(200, Math.max(0, now - this.previous));
    this.previous = now;
    if (now - this.started <= this.calibrationMs) {
      this.calibration.push(db);
      const levels = [...this.calibration].sort((a, b) => a - b);
      this.floor = levels[Math.floor((levels.length - 1) * 0.2)];
      return "continue";
    }
    const threshold = Math.max(this.minimumSpeechDb, this.floor + 12);
    if (db > threshold) {
      this.speechMs += elapsed;
      this.lastSpeech = now;
    } else if (!this.lastSpeech) {
      this.floor = Math.min(-40, this.floor * 0.95 + db * 0.05);
    }
    if (this.speechMs >= 400 && now - this.lastSpeech >= 1400) return "send";
    if (now - this.started >= this.maximumTurnMs)
      return this.speechMs >= 400 ? "send" : "idle";
    return "continue";
  }
}

export function stableTreeIndex(id: string, count: number) {
  let hash = 2166136261;
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return count > 0 ? (hash >>> 0) % count : 0;
}

export function treeVoiceSettings(personality: string) {
  return {
    stability: personality === "warm" ? 0.42 : 0.32,
    similarity_boost: 0.75,
    style: personality === "warm" ? 0.35 : 0.65,
    use_speaker_boost: true,
    speed:
      personality === "watchful"
        ? 0.94
        : personality === "waterlogged"
          ? 0.88
          : 1,
  };
}
