import { lazy, Suspense, useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polygon,
  Popup,
  useMap,
} from "react-leaflet";
import {
  Leaf,
  Map as MapIcon,
  Trophy,
  Sparkles,
  Plus,
  ArrowUpRight,
  Droplets,
  Thermometer,
  Volume2,
  X,
  Navigation,
  TreePine,
  LogOut,
} from "lucide-react";
import {
  DEMO_PASSWORD,
  type Tree,
  type WateringSession,
  type InsightResponse,
} from "@treequest/shared";
import { api, client, devDemo, key } from "./client";
const Simulator = import.meta.env.DEV
  ? lazy(() => import("./Simulator"))
  : null;
const time = (s: string | null) =>
  s ? new Date(s).toLocaleString() : "No readings";
function Recenter({
  tree,
  location,
}: {
  tree: Tree | null;
  location: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    const center = location ?? (tree && { lat: tree.lat, lng: tree.lng });
    if (center) map.flyTo([center.lat, center.lng], location ? 15 : 16, { duration: 0.5 });
  }, [location?.lat, location?.lng, tree?.id]);
  return null;
}
export default function App() {
  const qc = useQueryClient();
  const snapshot = useQuery({
    queryKey: ["world"],
    queryFn: () => api.snapshot(),
    enabled: !!key,
    refetchInterval: 60000,
  });
  const [user, setUser] = useState<string | null>(null),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<"map" | "insights" | "leaderboard">("map"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [realtime, setRealtime] = useState(false),
    [location, setLocation] = useState<{ lat: number; lng: number } | null>(
      null,
    ),
    [simLocation, setSimLocation] = useState(devDemo),
    [session, setSession] = useState<WateringSession | null>(null),
    [registration, setRegistration] = useState(false);
  const data = snapshot.data;
  const tree = data?.trees.find((t) => t.id === selected) ?? null;
  const me = data?.players.find((p) => p.id === user);
  const demo = devDemo && data?.config.demo_mode;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["world"] });
    void qc.invalidateQueries({ queryKey: ["dialogue"] });
  };
  useEffect(() => {
    client.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user.id ?? null));
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_e, s) => setUser(s?.user.id ?? null));
    const channel = client
      .channel("world")
      .on("postgres_changes", { event: "*", schema: "public" }, () => refresh())
      .subscribe((status) => {
        setRealtime(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") refresh();
      });
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) refresh();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      subscription.unsubscribe();
      client.removeChannel(channel);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        setLocation({ lat: coords.latitude, lng: coords.longitude }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);
  useEffect(() => {
    setSession(null);
  }, [selected, user]);
  const dialogue = useQuery({
    queryKey: ["dialogue", tree?.id, tree?.updated_at, user],
    queryFn: () =>
      api.call<{ message: string; source: string }>("tree-dialogue", {
        tree_id: tree!.id,
      }),
    enabled: !!tree && !!user,
  });
  useEffect(() => {
    if (!session) return;
    const interval = setInterval(async () => {
      const { data } = await client
        .from("watering_sessions")
        .select("*")
        .eq("id", session.id)
        .single();
      if (data) setSession(data as WateringSession);
    }, 2000);
    return () => clearInterval(interval);
  }, [session?.id]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function locate() {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
      }),
    );
    const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setLocation(loc);
    return loc;
  }
  async function start() {
    if (!tree) return;
    const loc =
      demo && simLocation
        ? { lat: tree.lat, lng: tree.lng }
        : (location ?? (await locate()));
    setLocation(loc);
    setSession(
      await api.call("watering-sessions", {
        tree_id: tree.id,
        request_id: tree.request_id,
        ...loc,
        idempotency_key: crypto.randomUUID(),
      }),
    );
  }
  async function voice() {
    if (!tree) return;
    const result = await api.call("tree-voice", { tree_id: tree.id });
    if (result.url) await new Audio(result.url).play();
    else if (result.source === "simulated" && "speechSynthesis" in window) {
      speechSynthesis.speak(new SpeechSynthesisUtterance(result.message));
    } else
      setError(
        "Voice is unavailable. The tree’s message is available as text.",
      );
  }
  if (!key)
    return (
      <div className="setup">
        <Leaf size={48} />
        <h1>Welcome to TreeQuest</h1>
        <p>
          Start local Supabase, then run <code>npm run demo:setup</code> to
          connect the demo.
        </p>
        <p>See README.md for the full setup.</p>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#">
          <span className="brand-icon">
            <Leaf size={24} />
          </span>
          <span>
            treequest<span className="brand-dot">.</span>
          </span>
        </a>
        <p className="eyebrow">GROW YOUR CORNER OF THE WORLD</p>
        <nav>
          {(
            [
              ["map", MapIcon, "Explore the grove"],
              ["insights", Sparkles, "Ask my trees"],
              ["leaderboard", Trophy, "Leaderboard"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              {label}
              {id === tab && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="side-card">
          <div className="tiny-tree">
            <TreePine size={44} />
          </div>
          <h3>
            Small acts.
            <br />
            Lasting roots.
          </h3>
          <p>
            Care for real trees, grow your territory, and leave your
            neighborhood greener.
          </p>
          <button onClick={() => setRegistration(true)} disabled={!user}>
            <Plus size={16} /> Register a tree
          </button>
        </div>
        <div className="side-bottom">
          <span
            className={realtime ? "connection" : "connection disconnected"}
          />
          {realtime ? "Grove connected" : "Reconnecting to grove"}
          <small>
            {demo ? "DEMO · SIMULATED HARDWARE & HISTORY" : "LIVE INTEGRATIONS"}
          </small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="eyebrow">YOUR NEIGHBORHOOD, A LITTLE GREENER</span>
            <h1>
              {tab === "map"
                ? "Good things take roots."
                : tab === "insights"
                  ? "Listen to your grove."
                  : "A little friendly competition."}
            </h1>
          </div>
          <div className="profile">
            <div className="avatar" style={{ background: me?.color }}>
              {me?.display_name.charAt(0) ?? "?"}
            </div>
            <div>
              <strong>{me?.display_name ?? "Explorer"}</strong>
              <small>
                {user ? "Neighborhood caretaker" : "Sign in to care for trees"}
              </small>
            </div>
            {user && (
              <button
                className="icon"
                aria-label="Sign out"
                onClick={() => client.auth.signOut()}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </header>
        {!online && (
          <div className="notice error">
            You’re offline. Actions are paused until your connection returns.
          </div>
        )}
        {(error || snapshot.error) && (
          <div role="alert" className="notice error">
            {error || (snapshot.error as Error).message}
            <button
              className="icon"
              onClick={() => {
                setError("");
                refresh();
              }}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!user && <Login onError={setError} demo={!!demo} />}
        <section className="stats">
          <div>
            <span className="stat-icon">
              <Leaf />
            </span>
            <div>
              <small>YOUR CARE POINTS</small>
              <strong>
                {me?.points ?? 0}
                <em>Keep growing</em>
              </strong>
            </div>
          </div>
          <div>
            <span className="stat-icon ochre">
              <TreePine />
            </span>
            <div>
              <small>TREES IN YOUR CARE</small>
              <strong>
                {me?.owned_trees ?? 0}
                <em>A living little legacy</em>
              </strong>
            </div>
          </div>
          <div>
            <span className="stat-icon purple">
              <MapIcon />
            </span>
            <div>
              <small>TERRITORIES CONTROLLED</small>
              <strong>
                {data?.territories.filter((t) => !!user && t.owner_id === user)
                  .length ?? 0}
                <em>
                  {Math.round((data?.config.territory_ratio ?? 0.8) * 100)}%
                  territory control target
                </em>
              </strong>
            </div>
          </div>
        </section>
        {snapshot.isLoading ? (
          <div className="empty">Finding your grove…</div>
        ) : tab === "map" ? (
          <>
            <div className="section-heading">
              <div>
                <h2>Your living neighborhood</h2>
                <p>Find a tree. Hear its story. Help it thrive.</p>
              </div>
              <button
                className="mobile-register secondary"
                disabled={!user}
                onClick={() => setRegistration(true)}
              >
                <Plus size={15} /> Register a tree
              </button>
              <button
                className="secondary"
                onClick={() =>
                  action(async () => {
                    await locate();
                  })
                }
              >
                <Navigation size={15} /> Find me
              </button>
            </div>
            <div className="map-layout">
              <section className="map-card">
                <MapContainer
                  center={[40.772, -73.966]}
                  zoom={15}
                  className="map"
                  zoomControl={false}
                >
                  <TileLayer
                    attribution="© OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {data?.territories.map((t) => (
                    <Polygon
                      key={t.id}
                      positions={t.geojson.coordinates[0].map(
                        ([lng, lat]) => [lat, lng] as [number, number],
                      )}
                      pathOptions={{
                        color:
                          data.players.find((p) => p.id === t.owner_id)
                            ?.color ?? "#778c76",
                        weight: 2,
                        dashArray: "6 7",
                        fillOpacity: 0.08,
                      }}
                    >
                      <Popup>
                        {t.name}
                        <br />
                        {data.players.find((p) => p.id === t.owner_id)
                          ?.display_name ?? "Unclaimed territory"}
                      </Popup>
                    </Polygon>
                  ))}
                  {data?.trees.map((t) => (
                    <CircleMarker
                      key={t.id}
                      center={[t.lat, t.lng]}
                      radius={selected === t.id ? 14 : 10}
                      pathOptions={{
                        color:
                          data.players.find((p) => p.id === t.owner_id)
                            ?.color ?? "#fff",
                        weight: 4,
                        fillColor:
                          t.status === "thirsty"
                            ? "#df9b3d"
                            : t.status === "healthy"
                              ? "#287d60"
                              : "#9ca9a1",
                        fillOpacity: 1,
                      }}
                      eventHandlers={{ click: () => setSelected(t.id) }}
                    >
                      <Popup>
                        <strong>{t.name}</strong>
                        <br />
                        {t.status} · {t.owner_id ? "Owned" : "Unclaimed"}
                      </Popup>
                    </CircleMarker>
                  ))}
                  {location && (
                    <CircleMarker
                      center={[location.lat, location.lng]}
                      radius={7}
                      pathOptions={{
                        color: "#fff",
                        weight: 3,
                        fillColor: "#3576ed",
                        fillOpacity: 1,
                      }}
                    />
                  )}
                  <Recenter tree={tree} location={location} />
                </MapContainer>
                <div className="map-label">
                  <span className="connection" /> {data?.trees.length ?? 0}{" "}
                  trees · {data?.territories.length ?? 0} growing communities
                </div>
                <div className="map-legend">
                  <span>
                    <i className="green" />
                    Healthy
                  </span>
                  <span>
                    <i className="yellow" />
                    Thirsty
                  </span>
                  <span>
                    <i className="gray" />
                    Unknown / inactive
                  </span>
                  <span>Ring = owner</span>
                </div>
              </section>
              <aside className="tree-panel">
                {tree ? (
                  <>
                    <div className="tree-art">
                      {tree.photo_path ? (
                        <img
                          src={
                            client.storage
                              .from("tree-photos")
                              .getPublicUrl(tree.photo_path).data.publicUrl
                          }
                          alt={tree.name}
                        />
                      ) : (
                        <>
                          <div className="art-sun" />
                          <TreePine size={110} strokeWidth={1} />
                          <Leaf className="art-leaf" size={40} />
                        </>
                      )}
                      <span className={`badge ${tree.status}`}>
                        {tree.status === "thirsty"
                          ? "Ready for a little care"
                          : tree.status}
                      </span>
                      <button
                        className="close icon"
                        onClick={() => setSelected(null)}
                        aria-label="Close tree"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="tree-content">
                      <span className="eyebrow">MEET YOUR NEIGHBOR</span>
                      <h2>{tree.name}</h2>
                      <p>
                        {tree.species_name ?? "Unidentified species"} ·{" "}
                        {
                          data?.territories.find(
                            (t) => t.id === tree.territory_id,
                          )?.name
                        }
                      </p>
                      <div className="owner">
                        <span
                          className="owner-dot"
                          style={{
                            background:
                              data?.players.find((p) => p.id === tree.owner_id)
                                ?.color ?? "#b7c5bb",
                          }}
                        />
                        In the care of{" "}
                        <strong>
                          {data?.players.find((p) => p.id === tree.owner_id)
                            ?.display_name ?? "no one yet"}
                        </strong>
                      </div>
                      <div className="measurements">
                        <div>
                          <Droplets size={17} />
                          <strong>
                            {tree.moisture ?? "—"}
                            <small>%</small>
                          </strong>
                          <span>Soil moisture</span>
                        </div>
                        <div>
                          <Thermometer size={17} />
                          <strong>
                            {tree.temperature ?? "—"}
                            <small>°C</small>
                          </strong>
                          <span>Temperature</span>
                        </div>
                      </div>
                      <small className="timestamp">
                        Last reading: {time(tree.reading_at)}
                      </small>
                      <blockquote>
                        “
                        {dialogue.data?.message ??
                          (user
                            ? "Listening to the tree…"
                            : "Sign in to hear my story.")}
                        ”
                      </blockquote>
                      <button
                        className="text-button"
                        disabled={!user || busy || !online}
                        onClick={() => action(voice)}
                      >
                        <Volume2 size={16} /> Listen to this tree{" "}
                        {demo && <small>· device voice demo</small>}
                      </button>
                      <p className="care-note">
                        Recovery threshold:{" "}
                        {tree.recovery_pct ?? "not configured"}%.{" "}
                        {demo ? "Illustrative care values." : ""} Only verified
                        recovery earns points.
                      </p>
                      <button
                        className="primary full"
                        disabled={
                          !user ||
                          !tree.request_id ||
                          busy ||
                          !online ||
                          session?.status === "active"
                        }
                        onClick={() => action(start)}
                      >
                        <Droplets size={17} />
                        {session?.status === "active"
                          ? "Waiting for sensor verification"
                          : tree.request_id
                            ? `Start a care session · +${data?.config.care_points ?? 10}`
                            : "No watering needed"}
                      </button>
                      {session && (
                        <div className="session" role="status">
                          <strong>Session: {session.status}</strong>
                          <code className="session-id">{session.id}</code>
                          <span>
                            Moisture {tree.moisture}% → recovery{" "}
                            {tree.recovery_pct}%
                          </span>
                          <span>Expires {time(session.expires_at)}</span>
                          <progress
                            max={tree.recovery_pct ?? 100}
                            value={tree.moisture ?? 0}
                          />
                        </div>
                      )}
                      {demo && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={simLocation}
                            onChange={(e) => setSimLocation(e.target.checked)}
                          />{" "}
                          Simulate location at selected tree
                        </label>
                      )}
                      {demo && Simulator && (
                        <Suspense fallback={null}>
                          <Simulator
                            treeId={tree.id}
                            sessionId={
                              session?.status === "active"
                                ? session.id
                                : undefined
                            }
                            onChange={refresh}
                            onError={setError}
                          />
                        </Suspense>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty tree-empty">
                    <TreePine size={54} />
                    <h2>Every tree has a story.</h2>
                    <p>
                      Select a marker or a tree below to meet your next leafy
                      neighbor.
                    </p>
                    <small>
                      Gold markers need care.
                      <br />
                      Fresh evidence keeps watering responsible.
                    </small>
                  </div>
                )}
              </aside>
            </div>
            <div className="section-heading">
              <div>
                <h2>A little care goes a long way</h2>
                <p>These neighbors could use a hand.</p>
              </div>
              <span className="muted">
                {data?.trees.filter((t) => t.request_id).length} active requests
              </span>
            </div>
            <div className="tree-list">
              {data?.trees
                .filter((t) => t.request_id)
                .map((t) => (
                  <button
                    key={t.id}
                    className="tree-item"
                    onClick={() => setSelected(t.id)}
                  >
                    <span className="mini-tree">
                      <TreePine size={28} />
                    </span>
                    <span>
                      <strong>{t.name}</strong>
                      <small>
                        {t.species_name} · {t.moisture}% moisture
                      </small>
                    </span>
                    <span className="points">
                      +{data?.config.care_points ?? 10}
                      <ArrowUpRight size={17} />
                    </span>
                  </button>
                ))}
              {!data?.trees.some((t) => t.request_id) && (
                <p className="empty">
                  The grove has no active watering requests.
                </p>
              )}
            </div>
          </>
        ) : tab === "insights" ? (
          <Insights
            user={user}
            online={online}
            select={(id) => {
              setSelected(id);
              setTab("map");
            }}
          />
        ) : (
          <section className="leaderboard">
            <h2>Growing together</h2>
            <p>Points come from verified care. Every healthy tree is a win.</p>
            {data?.players.map((p, i) => (
              <div key={p.id} className="rank">
                <span className="rank-number">0{i + 1}</span>
                <span className="avatar" style={{ background: p.color }}>
                  {p.display_name[0]}
                </span>
                <strong>
                  {p.display_name}
                  {p.id === user ? " (you)" : ""}
                  <small>{p.owned_trees} trees in care</small>
                </strong>
                <b>
                  {p.points}
                  <small>care points</small>
                </b>
              </div>
            ))}
          </section>
        )}
        <footer>
          <Leaf size={14} /> Rooted in care. Powered by community.
          <span>
            {demo
              ? "Demo data · fictional trees and players"
              : "Water only when the backend permits it."}
          </span>
        </footer>
      </main>
      {registration && (
        <Registration
          species={data?.species ?? []}
          location={location}
          selected={tree}
          demo={!!demo}
          onClose={() => setRegistration(false)}
          onSaved={(id) => {
            setSelected(id);
            setRegistration(false);
            setTab("map");
            refresh();
          }}
        />
      )}
    </div>
  );
}
function Login({
  onError,
  demo,
}: {
  onError: (s: string) => void;
  demo: boolean;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(email: string, password: string, signup = false) {
    setBusy(true);
    const r = signup
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (r.error) onError(r.error.message);
    setBusy(false);
  }
  return (
    <div className="login">
      <strong>Join your neighborhood</strong>
      {demo && (
        <div className="demo-login">
          {[1, 2, 3].map((n) => (
            <button
              disabled={busy}
              key={n}
              onClick={() => login(`player${n}@treequest.local`, DEMO_PASSWORD)}
            >
              Play as {["Alex", "Maya", "Sam"][n - 1]}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login(email, password);
        }}
      >
        <input
          aria-label="Email"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          aria-label="Password"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <button disabled={busy}>Sign in</button>
        <button
          type="button"
          disabled={busy}
          onClick={() => login(email, password, true)}
        >
          Create account
        </button>
      </form>
    </div>
  );
}
function Insights({
  user,
  online,
  select,
}: {
  user: string | null;
  online: boolean;
  select: (id: string) => void;
}) {
  const [question, setQuestion] = useState("How are my trees doing this week?"),
    [result, setResult] = useState<InsightResponse | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    setResult(null);
    setError("");
  }, [user]);
  async function ask(q = question) {
    setQuestion(q);
    setBusy(true);
    setError("");
    try {
      const requestedUser = user;
      const answer = await api.call<InsightResponse>("tree-insights", {
        question: q,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (userRef.current === requestedUser) setResult(answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="insights">
      <span className="insights-icon">
        <Sparkles size={28} />
      </span>
      <h2>What’s happening in your grove?</h2>
      <p>Explore the stories in your trees’ sensor readings.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          aria-label="Question about your trees"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={1000}
        />
        <button className="primary" disabled={busy || !user || !online}>
          {busy ? "Reading the leaves…" : "Ask my trees"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      <div className="suggestions">
        {[
          "Which of my trees needs water most urgently?",
          "Which of my trees have been getting drier?",
          "How does this week compare with last week?",
        ].map((q) => (
          <button
            key={q}
            disabled={busy || !user || !online}
            onClick={() => ask(q)}
          >
            {q}
          </button>
        ))}
      </div>
      <small>
        “My trees” means trees you currently own. Weeks start Monday in your
        timezone.
      </small>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {result && (
        <article className="answer">
          <span className="eyebrow">
            {result.source === "simulated"
              ? "SIMULATED HISTORY"
              : "TIGER DATA HISTORY"}{" "}
            ·{" "}
            {result.complete
              ? "AVAILABLE HISTORY"
              : "INCOMPLETE / UNAVAILABLE HISTORY"}
          </span>
          <h3>Your grove, in a nutshell</h3>
          <p className="answer-text">{result.answer}</p>
          <small>
            {time(result.period.from)} — {time(result.period.to)} (
            {result.period.timezone})
          </small>
          <p>
            Awaiting delivery: {result.delivery.pending} · Failed:{" "}
            {result.delivery.failed}. These readings are excluded from
            historical statistics.
          </p>
          {result.warnings.map((w) => (
            <div className="notice" key={w}>
              {w}
            </div>
          ))}
          <div className="analytics-cards">
            {result.statistics.map((s: any) => (
              <div className="analytics-card" key={s.tree_id}>
                <button
                  className="text-button"
                  onClick={() => select(s.tree_id)}
                >
                  {s.name}
                  <ArrowUpRight size={15} />
                </button>
                <strong>
                  {s.moisture_average ?? "—"}%{" "}
                  <small>daily-weighted moisture</small>
                </strong>
                <p>
                  {s.readings} readings · {s.missing_days} missing days
                </p>
                <p>Temperature: {s.temperature_average ?? "—"} °C</p>
                <small>
                  Latest delivered in period: {time(s.latest_reading)}
                </small>
                <small>
                  Current Supabase reading: {time(s.current.reading_at)}
                </small>
                <details>
                  <summary>Supporting statistics</summary>
                  <pre>{JSON.stringify(s, null, 2)}</pre>
                </details>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
function Registration({
  species,
  location,
  selected,
  demo,
  onClose,
  onSaved,
}: {
  species: any[];
  location: { lat: number; lng: number } | null;
  selected: Tree | null;
  demo: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(""),
    [speciesId, setSpecies] = useState(""),
    [photo, setPhoto] = useState(""),
    [description, setDescription] = useState(""),
    [lat, setLat] = useState(location?.lat ?? selected?.lat ?? 40.772),
    [lng, setLng] = useState(location?.lng ?? selected?.lng ?? -73.969),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [nearby, setNearby] = useState<{ id: string; name: string }[]>([]);
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      const path = await api.uploadPhoto(
        file,
        file.name.split(".").at(-1),
        file.type,
      );
      setPhoto(path);
      const r = await api.call("identify-tree", { photo_path: path });
      setDescription(
        `${r.source}: ${r.description}${r.uncertain ? " Identification uncertain; confirm or leave unidentified." : ""}`,
      );
      if (!r.uncertain)
        setSpecies(
          species.find(
            (s) => s.name.toLowerCase() === r.species_name?.toLowerCase(),
          )?.id ?? "",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(confirm_new = false) {
    setBusy(true);
    setError("");
    try {
      const r = await api.call("register-tree", {
        name,
        species_id: speciesId || null,
        photo_path: photo,
        lat,
        lng,
        confirm_new,
      });
      if (r.nearby) setNearby(r.nearby);
      else onSaved(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Register a tree"
        className="modal"
      >
        <button
          className="icon close"
          onClick={onClose}
          aria-label="Close registration"
        >
          <X />
        </button>
        <h2>Welcome a tree to the grove</h2>
        <p>Upload a photo, confirm the species, and place your tree.</p>
        <label>
          Tree photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0]);
            }}
          />
        </label>
        {description && <div className="notice">{description}</div>}
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </label>
        <label>
          Confirmed species
          <select
            value={speciesId}
            onChange={(e) => setSpecies(e.target.value)}
          >
            <option value="">Unidentified</option>
            {species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="coordinates">
          <label>
            Latitude
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => setLat(Number(e.target.value))}
            />
          </label>
          <label>
            Longitude
            <input
              type="number"
              step="any"
              value={lng}
              onChange={(e) => setLng(Number(e.target.value))}
            />
          </label>
        </div>
        <small>
          {demo ? "Demo identification is simulated. " : ""}New trees need an
          assigned device and configured care profile before watering.
        </small>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {nearby.length > 0 && (
          <div className="notice">
            <strong>Nearby trees already exist</strong>
            {nearby.map((t) => (
              <button key={t.id} onClick={() => onSaved(t.id)}>
                {t.name} · use existing
              </button>
            ))}
            <button onClick={() => save(true)} disabled={busy}>
              Confirm this is a different tree
            </button>
          </div>
        )}
        <button
          className="primary full"
          disabled={busy || !name || !photo}
          onClick={() => save()}
        >
          {busy ? "Working…" : "Register tree"}
        </button>
      </section>
    </div>
  );
}
