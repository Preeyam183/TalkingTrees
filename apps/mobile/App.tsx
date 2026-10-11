import "react-native-url-polyfill/auto";
import React, { useEffect, useState, useRef } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  Modal,
  ActivityIndicator,
  Image,
  AppState,
} from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import * as Speech from "expo-speech";
import * as Crypto from "expo-crypto";
import { useAudioPlayer } from "expo-audio";
import { type WateringSession, type InsightResponse } from "@treequest/shared";
import { api, client, demoBuild, url } from "./client";
import AuthScreen from "./AuthScreen";
import TreeChat from "./TreeChat";
import {
  decodeBase64,
  connectionMessage,
  type IdentificationResponse,
} from "@treequest/shared";
const stamp = (s: string | null) =>
  s ? new Date(s).toLocaleString() : "No readings";
function Button({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && { opacity: 0.4 }]}
    >
      <Text style={styles.buttonText}>{title}</Text>
    </Pressable>
  );
}
export default function App() {
  const [data, setData] = useState<Awaited<
      ReturnType<typeof api.snapshot>
    > | null>(null),
    [user, setUser] = useState<string | null>(null),
    [authReady, setAuthReady] = useState(false),
    [scanning, setScanning] = useState(false),
    [scanResult, setScanResult] = useState<IdentificationResponse | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("map"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [session, setSession] = useState<WateringSession | null>(null),
    [message, setMessage] = useState(""),
    [question, setQuestion] = useState("How are my trees doing this week?"),
    [insight, setInsight] = useState<InsightResponse | null>(null),
    [register, setRegister] = useState(false),
    [renaming, setRenaming] = useState(false),
    [renameName, setRenameName] = useState(""),
    [photo, setPhoto] = useState(""),
    [name, setName] = useState(""),
    [species, setSpecies] = useState<string | null>(null),
    [identification, setIdentification] = useState(""),
    [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null),
    [realtime, setRealtime] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    setInsight(null);
  }, [user]);
  const tree = data?.trees.find((t) => t.id === selected);
  const me = data?.players.find((p) => p.id === user);
  const demo = demoBuild && data?.config.demo_mode;
  const player = useAudioPlayer(null);
  async function refresh() {
    if (!userRef.current) return;
    const requestedUser = userRef.current;
    try {
      const next = await api.snapshot();
      if (userRef.current === requestedUser) setData(next);
    } catch (e) {
      setError(connectionMessage(e, url));
    }
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(connectionMessage(e, url));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    client.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error;
        setUser(data.session?.user.id ?? null);
      })
      .catch((e) => setError(connectionMessage(e, url)))
      .finally(() => setAuthReady(true));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user.id ?? null);
      if (!s) {
        setData(null);
        setSelected(null);
        setRegister(false);
        setScanning(false);
      }
    });
    const channel = client
      .channel("mobile-world")
      .on("postgres_changes", { event: "*", schema: "public" }, refresh)
      .subscribe((s) => setRealtime(s === "SUBSCRIBED"));
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        client.auth.startAutoRefresh();
        refresh();
      } else client.auth.stopAutoRefresh();
    });
    return () => {
      subscription.unsubscribe();
      client.removeChannel(channel);
      app.remove();
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => clearInterval(timer);
  }, [user]);
  useEffect(() => {
    setSession(null);
    setRenaming(false);
    setRenameName(tree?.name ?? "");
  }, [selected, user]);
  useEffect(() => {
    setMessage("");
    if (tree && user)
      api
        .call("tree-dialogue", { tree_id: tree.id })
        .then((r) => setMessage(r.message))
        .catch((e) => setError(e.message));
  }, [tree?.id, tree?.updated_at, user]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(async () => {
      const { data } = await client
        .from("watering_sessions")
        .select("*")
        .eq("id", session.id)
        .single();
      if (data) setSession(data as WateringSession);
    }, 2000);
    return () => clearInterval(timer);
  }, [session?.id]);
  async function position() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted")
      throw new Error("Location permission is required to verify proximity.");
    const p = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const l = { lat: p.coords.latitude, lng: p.coords.longitude };
    setLoc(l);
    return l;
  }
  async function start() {
    if (!tree) return;
    const p = demo ? { lat: tree.lat, lng: tree.lng } : await position();
    setLoc(p);
    const idempotency_key = Crypto.randomUUID();
    setSession(
      await api.call("watering-sessions", {
        tree_id: tree.id,
        request_id: tree.request_id,
        ...p,
        idempotency_key,
      }),
    );
  }
  async function renameTree() {
    if (!tree) return;
    await api.call("rename-tree", { tree_id: tree.id, name: renameName });
    setRenaming(false);
  }
  async function voice() {
    if (!tree) return;
    const r = await api.call("tree-voice", { tree_id: tree.id });
    if (r.url) {
      player.replace(r.url);
      player.play();
    } else if (r.source === "simulated") Speech.speak(r.message);
    else Alert.alert("Voice unavailable", r.message);
  }
  async function ask(q = question) {
    setQuestion(q);
    const requestedUser = user;
    const answer = await api.call<InsightResponse>("tree-insights", {
      question: q,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (userRef.current === requestedUser) setInsight(answer);
  }
  async function photoPick(camera: boolean) {
    if (camera) {
      const p = await ImagePicker.requestCameraPermissionsAsync();
      if (!p.granted) throw new Error("Camera permission required");
    }
    const r = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.7,
          base64: true,
        });
    if (r.canceled) return;
    const asset = r.assets[0];
    if (!asset.base64)
      throw new Error("Could not read photo. Please take another picture.");
    const bytes = decodeBase64(asset.base64);
    const path = await api.uploadPhoto(
      bytes,
      "jpg",
      asset.mimeType ?? "image/jpeg",
    );
    setPhoto(path);
    const identification = await api.call("identify-tree", {
      photo_path: path,
    });
    setIdentification(
      `${identification.source}: ${identification.description}${identification.uncertain ? " Please confirm or leave unidentified." : ""}`,
    );
    setSpecies(
      identification.uncertain
        ? null
        : (data?.species.find((s) => s.name === identification.species_name)
            ?.id ?? null),
    );
  }
  async function save(confirm_new = false) {
    const l = loc ?? (demo ? { lat: 40.772, lng: -73.969 } : await position());
    const r = await api.call("register-tree", {
      name,
      species_id: species,
      photo_path: photo,
      ...l,
      confirm_new,
    });
    if (r.nearby) {
      Alert.alert(
        "Nearby trees exist",
        "Choose an existing record or confirm a different tree.",
        [
          ...r.nearby.slice(0, 2).map((t: any) => ({
            text: t.name,
            onPress: () => {
              setSelected(t.id);
              setRegister(false);
            },
          })),
          { text: "Different tree", onPress: () => run(() => save(true)) },
          { text: "Cancel", style: "cancel" },
        ],
      );
    } else {
      setSelected(r.id);
      setRegister(false);
      setTab("map");
    }
  }
  async function scan() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      throw new Error("Allow camera access in Settings to scan a tree.");
    const image = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
    });
    if (image.canceled) return;
    const asset = image.assets[0];
    if (!asset.base64)
      throw new Error("Could not read the photo. Please try again.");
    const path = await api.uploadPhoto(
      decodeBase64(asset.base64),
      "jpg",
      "image/jpeg",
    );
    let location: { lat: number; lng: number } | undefined;
    try {
      location = demo ? { lat: 40.771, lng: -73.9696 } : await position();
    } catch {
      /* Species identification still works without location. */
    }
    setScanResult(
      await api.call<IdentificationResponse>("identify-tree", {
        photo_path: path,
        ...location,
      }),
    );
  }
  if (!authReady)
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator
          accessibilityLabel="Opening your grove"
          color="#365d3d"
        />
      </SafeAreaView>
    );
  if (!user) return <AuthScreen />;
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.brand}>♧ treequest.</Text>
          {user && (
            <Button title="Sign out" onPress={() => client.auth.signOut()} />
          )}
        </View>
        <Text style={styles.eyebrow}>GROW YOUR CORNER OF THE WORLD</Text>
        <Text style={styles.heading}>Good things take roots.</Text>
        <Text style={styles.muted}>
          {realtime ? "Grove connected" : "Connecting / disconnected"}
          {demo ? " · SIMULATED DEMO" : ""}
        </Text>
        {busy && <ActivityIndicator color="#365d3d" />}
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <View style={styles.summary}>
          <Text style={styles.summaryText}>{me?.points ?? 0} care points</Text>
          <Text style={styles.summaryText}>{me?.owned_trees ?? 0} trees</Text>
          <Text style={styles.summaryText}>
            {data?.territories.filter((t) => !!user && t.owner_id === user)
              .length ?? 0}{" "}
            territories
          </Text>
        </View>
        <View style={styles.row}>
          {["map", "insights", "leaderboard"].map((t) => (
            <Button
              key={t}
              title={t === "insights" ? "Ask trees" : t}
              onPress={() => setTab(t)}
            />
          ))}
        </View>
        {tab === "map" && (
          <>
            <MapView
              key={data?.trees[0]?.id ?? "empty-grove"}
              style={styles.map}
              initialRegion={{
                latitude: data?.trees[0]?.lat ?? 40.772,
                longitude: data?.trees[0]?.lng ?? -73.966,
                latitudeDelta: 0.012,
                longitudeDelta: 0.02,
              }}
              showsUserLocation
            >
              {data?.territories.map((t) => (
                <Polygon
                  key={t.id}
                  coordinates={t.geojson.coordinates[0].map(
                    ([longitude, latitude]) => ({ latitude, longitude }),
                  )}
                  strokeColor={
                    data.players.find((p) => p.id === t.owner_id)?.color ??
                    "#778c76"
                  }
                  fillColor="#758c7020"
                />
              ))}
              {data?.trees.map((t) => (
                <Marker
                  key={t.id}
                  coordinate={{ latitude: t.lat, longitude: t.lng }}
                  title={t.name}
                  description={`${t.status} · ${data.players.find((p) => p.id === t.owner_id)?.display_name ?? "Unclaimed"}`}
                  pinColor={
                    t.status === "thirsty"
                      ? "#dca044"
                      : t.status === "healthy"
                        ? "#367c58"
                        : "#9aa69a"
                  }
                  onPress={() => setSelected(t.id)}
                />
              ))}
            </MapView>
            <Text style={styles.muted}>
              Gold: thirsty · Green: healthy · Gray: unknown/inactive
            </Text>
            {tree ? (
              <View style={styles.card}>
                {tree.photo_path && (
                  <Image
                    source={{
                      uri: client.storage
                        .from("tree-photos")
                        .getPublicUrl(tree.photo_path).data.publicUrl,
                    }}
                    style={styles.photo}
                  />
                )}
                <Text style={styles.title}>{tree.name}</Text>
                {user === tree.owner_id &&
                  (renaming ? (
                    <>
                      <TextInput
                        style={styles.input}
                        accessibilityLabel="Tree name"
                        value={renameName}
                        maxLength={80}
                        onChangeText={setRenameName}
                      />
                      <Button
                        title="Save name"
                        disabled={busy}
                        onPress={() => run(renameTree)}
                      />
                      <Button
                        title="Cancel"
                        disabled={busy}
                        onPress={() => setRenaming(false)}
                      />
                    </>
                  ) : (
                    <Button
                      title="Rename tree"
                      disabled={busy}
                      onPress={() => setRenaming(true)}
                    />
                  ))}
                <Text style={styles.muted}>
                  {tree.species_name ?? "Unidentified"} · {tree.status}
                </Text>
                <Text>
                  Owner:{" "}
                  {data?.players.find((p) => p.id === tree.owner_id)
                    ?.display_name ?? "Unclaimed"}
                </Text>
                <Text style={styles.measure}>
                  {tree.moisture ?? "—"}% moisture · {tree.temperature ?? "—"}{" "}
                  °C
                </Text>
                <Text style={styles.muted}>{stamp(tree.reading_at)}</Text>
                <Text style={styles.quote}>
                  {message || "Sign in to hear my story."}
                </Text>
                <Button
                  title={
                    demo ? "Listen · device speech demo" : "Listen to tree"
                  }
                  disabled={!user || busy}
                  onPress={() => run(voice)}
                />
                <TreeChat key={`${user}:${tree.id}`} tree={tree} />
                <Text style={styles.muted}>
                  Recovery threshold {tree.recovery_pct ?? "unconfigured"}%.
                  Partial watering earns no points.
                </Text>
                <Button
                  title={
                    tree.request_id
                      ? "Start care session"
                      : "No watering permitted"
                  }
                  disabled={
                    !user ||
                    busy ||
                    !tree.request_id ||
                    session?.status === "active"
                  }
                  onPress={() => run(start)}
                />
                {session && (
                  <Text>
                    Session {session.status} · {session.id} · expires{" "}
                    {stamp(session.expires_at)}
                  </Text>
                )}
                {demo && (
                  <>
                    <Text style={styles.eyebrow}>
                      DEVELOPER SIMULATOR · LOCATION IS SIMULATED
                    </Text>
                    <Button
                      title="Make thirsty / refresh reading"
                      disabled={busy}
                      onPress={() =>
                        run(async () => {
                          await api.call("simulator", {
                            action: "reading",
                            tree_id: tree.id,
                            moisture: 22,
                          });
                        })
                      }
                    />
                    {["partial", "complete", "death"].map((action) => (
                      <Button
                        key={action}
                        title={`Simulate ${action}`}
                        disabled={
                          busy ||
                          (action !== "death" && session?.status !== "active")
                        }
                        onPress={() =>
                          run(async () => {
                            await api.call("simulator", {
                              action,
                              tree_id: tree.id,
                              session_id: session?.id,
                            });
                          })
                        }
                      />
                    ))}
                  </>
                )}
              </View>
            ) : (
              <Text style={styles.muted}>Select a tree to hear its story.</Text>
            )}
            <Button
              title="Scan a tree"
              disabled={busy}
              onPress={() => {
                setScanResult(null);
                setScanning(true);
              }}
            />
            <Button
              title="Register a tree"
              disabled={!user}
              onPress={() => setRegister(true)}
            />
            <Text style={styles.title}>Trees in your neighborhood</Text>
            {data?.trees.map((t) => (
              <Button
                key={t.id}
                title={`${t.name} · ${t.status} · ${t.moisture ?? "—"}%`}
                onPress={() => setSelected(t.id)}
              />
            ))}
          </>
        )}
        {tab === "leaderboard" &&
          data?.players.map((p, i) => (
            <View style={styles.card} key={p.id}>
              <Text style={styles.title}>
                {i + 1}. {p.display_name}
              </Text>
              <Text>
                {p.points} care points · {p.owned_trees} trees
              </Text>
            </View>
          ))}
        {tab === "insights" && (
          <View style={styles.card}>
            <Text style={styles.title}>Listen to your grove.</Text>
            <TextInput
              accessibilityLabel="Question about your trees"
              multiline
              style={styles.input}
              value={question}
              onChangeText={setQuestion}
            />
            <Button
              title="Ask my trees"
              disabled={!user || busy}
              onPress={() => run(() => ask())}
            />
            {[
              "Which of my trees needs water most urgently?",
              "Which of my trees have been getting drier?",
              "How does this week compare with last week?",
            ].map((q) => (
              <Button
                key={q}
                title={q}
                disabled={!user || busy}
                onPress={() => run(() => ask(q))}
              />
            ))}
            <Text style={styles.muted}>
              Currently owned trees only. Weeks start Monday in your timezone.
            </Text>
            {insight && (
              <>
                <Text style={styles.eyebrow}>
                  {insight.source.toUpperCase()} HISTORY
                </Text>
                <Text style={styles.quote}>{insight.answer}</Text>
                <Text style={styles.muted}>
                  {stamp(insight.period.from)} — {stamp(insight.period.to)} (
                  {insight.period.timezone})
                </Text>
                <Text>
                  Pending delivery: {insight.delivery.pending} · failed:{" "}
                  {insight.delivery.failed}. Undelivered readings are excluded.
                </Text>
                {insight.warnings.map((w) => (
                  <Text style={styles.error} key={w}>
                    {w}
                  </Text>
                ))}
                {insight.statistics.map((s: any) => (
                  <View style={styles.card} key={s.tree_id}>
                    <Button
                      title={s.name}
                      onPress={() => {
                        setSelected(s.tree_id);
                        setTab("map");
                      }}
                    />
                    <Text>
                      Average moisture {s.moisture_average ?? "—"}% ·
                      temperature {s.temperature_average ?? "—"} °C
                    </Text>
                    <Text>
                      {s.readings} readings · {s.missing_days} missing days
                    </Text>
                    <Text style={styles.muted}>
                      Latest delivered: {stamp(s.latest_reading)}
                    </Text>
                    <Text style={styles.muted}>
                      Latest Supabase: {stamp(s.current.reading_at)}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
        <Button title="Refresh grove" onPress={refresh} />
      </ScrollView>
      <Modal
        visible={scanning}
        animationType="slide"
        onRequestClose={() => setScanning(false)}
      >
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.heading}>Meet a tree</Text>
            <Text style={styles.muted}>
              Take a photo to identify its species and find nearby trees in your
              grove.
            </Text>
            <Button
              title="Open camera"
              disabled={busy}
              onPress={() => run(scan)}
            />
            {busy && <ActivityIndicator color="#365d3d" />}
            {!!error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {scanResult && (
              <>
                <Text style={styles.title}>
                  {scanResult.species_name ?? "Species unidentified"}
                </Text>
                <Text>{scanResult.description}</Text>
                <Text style={styles.muted}>{scanResult.match_note}</Text>
                {scanResult.candidates.map((candidate) => (
                  <View key={candidate.id} style={styles.card}>
                    <Text style={styles.title}>
                      {candidate.name} · {candidate.distance_m} m away
                    </Text>
                    <Text>Caretaker: {candidate.caretaker ?? "Unclaimed"}</Text>
                    <Text>Recorded status: {candidate.status}</Text>
                    <Text>
                      Moisture: {candidate.moisture ?? "unavailable"}% ·
                      temperature: {candidate.temperature ?? "unavailable"} °C
                    </Text>
                    <Text style={styles.muted}>
                      Latest calibrated reading: {stamp(candidate.reading_at)}
                    </Text>
                    <Button
                      title={`This is ${candidate.name}`}
                      onPress={() => {
                        setSelected(candidate.id);
                        setTab("map");
                        setScanning(false);
                      }}
                    />
                  </View>
                ))}
                {!scanResult.candidates.length && (
                  <Text style={styles.muted}>
                    No nearby record was found. Enable location or register this
                    tree if it is new.
                  </Text>
                )}
                <Button
                  title="Register a new tree"
                  onPress={() => {
                    setScanning(false);
                    setRegister(true);
                  }}
                />
              </>
            )}
            <Button title="Close scan" onPress={() => setScanning(false)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={register}
        animationType="slide"
        onRequestClose={() => setRegister(false)}
      >
        <SafeAreaView style={styles.safe}>
          <ScrollView contentContainerStyle={styles.container}>
            <Text style={styles.heading}>Welcome a tree</Text>
            <Button
              title="Take a photo"
              disabled={busy}
              onPress={() => run(() => photoPick(true))}
            />
            <Button
              title="Choose a photo"
              disabled={busy}
              onPress={() => run(() => photoPick(false))}
            />
            <Text>{identification}</Text>
            <TextInput
              style={styles.input}
              placeholder="Tree name"
              value={name}
              onChangeText={setName}
            />
            <Text style={styles.title}>Confirm species</Text>
            <Button
              title={`${species === null ? "✓ " : ""}Unidentified`}
              onPress={() => setSpecies(null)}
            />
            {data?.species.map((s) => (
              <Button
                key={s.id}
                title={`${species === s.id ? "✓ " : ""}${s.name}`}
                onPress={() => setSpecies(s.id)}
              />
            ))}
            <Button
              title="Use my current location"
              onPress={() =>
                run(async () => {
                  await position();
                })
              }
            />
            <Text style={styles.muted}>
              {loc
                ? `${loc.lat}, ${loc.lng}`
                : demo
                  ? "Demo location: Fernwood Grove"
                  : "Location required"}
            </Text>
            <Button
              title="Register tree"
              disabled={busy || !photo || !name}
              onPress={() => run(() => save())}
            />
            <Button title="Cancel" onPress={() => setRegister(false)} />
            {!!error && <Text style={styles.error}>{error}</Text>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f8f4" },
  container: { padding: 20, gap: 12 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: { fontSize: 27, fontWeight: "800", color: "#244c37" },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#829083",
    marginVertical: 6,
  },
  heading: { fontSize: 30, fontWeight: "800", color: "#243c32" },
  title: { fontSize: 20, fontWeight: "700", color: "#365d3d" },
  muted: { fontSize: 12, color: "#788579", lineHeight: 19 },
  error: {
    color: "#a34d42",
    padding: 10,
    backgroundColor: "#fff0eb",
    borderRadius: 8,
  },
  card: {
    padding: 18,
    backgroundColor: "#fff",
    borderRadius: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "#e3e8dc",
  },
  input: {
    borderWidth: 1,
    borderColor: "#dce4da",
    padding: 13,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  button: {
    backgroundColor: "#365d3d",
    padding: 12,
    borderRadius: 9,
    marginVertical: 3,
  },
  buttonText: { color: "#fff", fontWeight: "600", textAlign: "center" },
  row: { flexDirection: "row", gap: 8, justifyContent: "space-between" },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    backgroundColor: "#eaf0e2",
    borderRadius: 12,
  },
  summaryText: { fontSize: 12, color: "#365d3d", fontWeight: "600" },
  map: { height: 320, borderRadius: 14 },
  photo: { height: 150, borderRadius: 10 },
  measure: { fontSize: 20, color: "#365d3d", fontWeight: "600" },
  quote: {
    padding: 15,
    backgroundColor: "#f0f5e9",
    color: "#5d7654",
    lineHeight: 23,
    borderRadius: 9,
  },
});
