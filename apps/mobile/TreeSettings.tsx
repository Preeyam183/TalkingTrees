import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Modal,
  SafeAreaView,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useAudioPlayer } from "expo-audio";
import type { Tree, TreeSettingsResponse } from "@treequest/shared";
import { treeSettingsSchema } from "@treequest/shared";
import { api } from "./client";
import { ActionTile } from "./ActionTile";
import { playTreeAudio } from "./audio";
export function TreeSettings({
  tree,
  onSaved,
}: {
  tree: Tree;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(tree.name),
    [voice, setVoice] = useState<string | null>(null),
    [settings, setSettings] = useState<TreeSettingsResponse | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const openRef = useRef(open);
  openRef.current = open;
  const player = useAudioPlayer(null, { keepAudioSessionActive: true });
  const alive = useRef(true);
  const previewGeneration = useRef(0);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      previewGeneration.current++;
    };
  }, []);
  function close() {
    previewGeneration.current++;
    openRef.current = false;
    player.pause();
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    setError("");
    setSettings(null);
    void api
      .call<TreeSettingsResponse>("tree-settings", { tree_id: tree.id })
      .then((data) => {
        if (active) {
          setSettings(data);
          setName(data.name);
          setVoice(data.voice_id);
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
      if (alive.current) {
        close();
        onSaved();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function preview(uri: string) {
    const generation = ++previewGeneration.current;
    setBusy(true);
    setError("");
    try {
      await playTreeAudio(
        player,
        uri,
        () =>
          !alive.current ||
          !openRef.current ||
          generation !== previewGeneration.current,
      );
    } catch (e) {
      if (alive.current && generation === previewGeneration.current)
        setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <ActionTile
        title="Tree settings"
        icon="settings-outline"
        onPress={() => setOpen(true)}
      />
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={s.safe}>
          <ScrollView contentContainerStyle={s.content}>
            <Text style={s.heading}>Make this tree yours</Text>
            <Text style={s.label}>Tree name</Text>
            <TextInput
              accessibilityLabel="Tree name"
              value={name}
              maxLength={80}
              onChangeText={setName}
              style={s.input}
              editable={!busy}
            />
            <Text style={s.label}>Voice</Text>
            {busy && <ActivityIndicator color="#365d3d" />}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: voice === null }}
              disabled={busy}
              onPress={() => setVoice(null)}
              style={[s.option, voice === null && s.selected]}
            >
              <Text>{voice === null ? "✓ " : ""}Original tree voice</Text>
            </Pressable>
            {settings?.warning && <Text>{settings.warning}</Text>}
            {!!voice && !settings?.voices.some((v) => v.id === voice) && (
              <Text>Saved voice: {voice}</Text>
            )}
            {settings?.voices.map((v) => (
              <View key={v.id} style={s.voiceRow}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel={v.name}
                  accessibilityState={{ checked: voice === v.id }}
                  disabled={busy}
                  onPress={() => setVoice(v.id)}
                  style={[s.option, s.choice, voice === v.id && s.selected]}
                >
                  <Text>
                    {voice === v.id ? "✓ " : ""}
                    {v.name}
                  </Text>
                </Pressable>
                {v.preview_url && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Preview ${v.name}`}
                    disabled={busy}
                    onPress={() => void preview(v.preview_url!)}
                    style={s.preview}
                  >
                    <Text style={s.previewText}>▶</Text>
                  </Pressable>
                )}
              </View>
            ))}
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <View style={s.row}>
              <ActionTile
                title="Save settings"
                onPress={() => void save()}
                disabled={busy || !settings || !name.trim()}
              />
              <ActionTile title="Cancel" onPress={close} />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f8f4" },
  content: { padding: 24, gap: 12 },
  heading: { fontSize: 24, fontWeight: "700", color: "#244c37" },
  label: { fontSize: 16, fontWeight: "600", color: "#244c37" },
  input: {
    backgroundColor: "white",
    padding: 14,
    borderWidth: 1,
    borderColor: "#dce4da",
    borderRadius: 10,
  },
  option: {
    padding: 16,
    borderWidth: 1,
    borderColor: "#dce4da",
    borderRadius: 10,
    backgroundColor: "white",
  },
  selected: { borderColor: "#365d3d", backgroundColor: "#eaf0e2" },
  choice: { flex: 1 },
  voiceRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  preview: {
    width: 48,
    height: 48,
    backgroundColor: "#365d3d",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: { color: "white", fontSize: 20 },
  row: { flexDirection: "row", gap: 12 },
  error: { color: "#a23826" },
});
