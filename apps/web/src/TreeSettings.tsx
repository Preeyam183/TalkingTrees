import { useEffect, useRef, useState } from "react";
import { Settings, Volume2, X } from "lucide-react";
import {
  treeSettingsSchema,
  type Tree,
  type TreeSettingsResponse,
} from "@treequest/shared";
import { api } from "./client";
export default function TreeSettings({
  tree,
  onSaved,
}: {
  tree: Tree;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(tree.name),
    [voice, setVoice] = useState<string | null>(null),
    [data, setData] = useState<TreeSettingsResponse | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setData(null);
    setError("");
    void api
      .call<TreeSettingsResponse>("tree-settings", { tree_id: tree.id })
      .then((r) => {
        if (active) {
          setName(r.name);
          setVoice(r.voice_id);
          setData(r);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      audio.current?.pause();
    };
  }, [open, tree.id]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api.call(
        "update-tree-settings",
        treeSettingsSchema.parse({ tree_id: tree.id, name, voice_id: voice }),
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    const id = voice ?? data?.effective_voice_id;
    const uri = data?.voices.find((v) => v.id === id)?.preview_url;
    if (!uri) return;
    audio.current?.pause();
    audio.current = new Audio(uri);
    try {
      await audio.current.play();
    } catch {
      setError("Voice preview could not play. Try again.");
    }
  }
  return (
    <>
      <button className="text-button" onClick={() => setOpen(true)}>
        <Settings size={16} /> Tree settings
      </button>
      {open && (
        <div className="modal-backdrop">
          <section
            className="tree-settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Tree settings"
          >
            <button
              className="close icon"
              aria-label="Close settings"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
            <h2>Make this tree yours</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label>
                Tree name
                <input
                  aria-label="Tree name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                Voice
                <select
                  aria-label="Tree voice"
                  value={voice ?? ""}
                  onChange={(e) => setVoice(e.target.value || null)}
                  disabled={busy}
                >
                  <option value="">Original tree voice</option>
                  {!!voice && !data?.voices.some((v) => v.id === voice) && (
                    <option value={voice}>Saved voice</option>
                  )}
                  {data?.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => void preview()}
                disabled={
                  !data?.voices.find(
                    (v) => v.id === (voice ?? data.effective_voice_id),
                  )?.preview_url
                }
              >
                <Volume2 size={16} /> Preview voice
              </button>
              {data?.warning && <p>{data.warning}</p>}
              {!!error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button
                className="primary"
                type="submit"
                disabled={busy || !data || !name.trim()}
              >
                {busy ? "Loading…" : "Save settings"}
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
