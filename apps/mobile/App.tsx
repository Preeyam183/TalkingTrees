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
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  makeClient,
  createApi,
  DEMO_PASSWORD,
  type Tree,
  type WateringSession,
  type InsightResponse,
} from "@treequest/shared";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "not-configured";
const client = makeClient(url, key, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
const api = createApi(client, url, key, Crypto.randomUUID);
const demoBuild = __DEV__ && process.env.EXPO_PUBLIC_APP_MODE === "demo";
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
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("map"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
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
    try {
      setData(await api.snapshot());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    refresh();
    client.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user.id ?? null));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_e, s) => setUser(s?.user.id ?? null));
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
  async function login(n?: number, signup = false) {
    const e = n ? `player${n}@treequest.local` : email,
      p = n ? DEMO_PASSWORD : password;
    const r = signup
      ? await client.auth.signUp({ email: e, password: p })
      : await client.auth.signInWithPassword({ email: e, password: p });
    if (r.error) throw r.error;
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
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 0.7,
        });
    if (r.canceled) return;
    const asset = r.assets[0];
    const bytes = await (await fetch(asset.uri)).arrayBuffer();
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
        {!user && (
          <View style={styles.card}>
            <Text style={styles.title}>Join your neighborhood</Text>
            {demo &&
              [1, 2, 3].map((n) => (
                <Button
                  key={n}
                  title={`Play as ${["Alex", "Maya", "Sam"][n - 1]}`}
                  disabled={busy}
                  onPress={() => run(() => login(n))}
                />
              ))}
            <TextInput
              style={styles.input}
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <Button title="Sign in" onPress={() => run(() => login())} />
            <Button
              title="Create account"
              onPress={() => run(() => login(undefined, true))}
            />
          </View>
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
              style={styles.map}
              initialRegion={{
                latitude: 40.772,
                longitude: -73.966,
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
              title="Register a tree"
              disabled={!user}
              onPress={() => setRegister(true)}
            />
            <Text style={styles.title}>Neighbors who need care</Text>
            {data?.trees
              .filter((t) => t.request_id)
              .map((t) => (
                <Button
                  key={t.id}
                  title={`${t.name} · ${t.moisture}%`}
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
