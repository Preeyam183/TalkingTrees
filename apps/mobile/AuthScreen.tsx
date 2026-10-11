import { useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { DEMO_PASSWORD, connectionMessage } from "@treequest/shared";
import { client, demoBuild, url, configured } from "./client";
import { ActionTile } from "./ActionTile";

export default function AuthScreen() {
  const [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function submit(n?: number) {
    if (!configured) {
      setError(
        "Configure the mobile Supabase URL and public key, then restart Metro.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const e = n ? `player${n}@treequest.local` : email.trim(),
        p = n ? DEMO_PASSWORD : password;
      if (!e || (!n && p.length < 8))
        throw new Error(
          "Enter an email and a password of at least 8 characters.",
        );
      const result =
        signup && !n
          ? await client.auth.signUp({
              email: e,
              password: p,
              options: {
                data: { display_name: name.trim() || "Tree explorer" },
              },
            })
          : await client.auth.signInWithPassword({ email: e, password: p });
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setNotice("Check your email to confirm your account, then sign in.");
    } catch (e) {
      setError(connectionMessage(e, url));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>♧ Branch Out</Text>
        <Text style={s.tagline}>A little care. A living neighborhood.</Text>
        <View style={s.card}>
          <Text style={s.heading}>
            {signup ? "Create your account" : "Welcome back"}
          </Text>
          <Text style={s.muted}>
            {signup
              ? "Start your story as a neighborhood caretaker."
              : "Sign in to explore your grove."}
          </Text>
          {signup && (
            <TextInput
              accessibilityLabel="Your name"
              style={s.input}
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              maxLength={60}
              textContentType="name"
            />
          )}
          <TextInput
            accessibilityLabel="Email"
            style={s.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <TextInput
            accessibilityLabel="Password"
            style={s.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={signup ? "new-password" : "current-password"}
          />
          {busy && <ActivityIndicator color="#365d3d" />}
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          {!!notice && <Text style={s.muted}>{notice}</Text>}
          <View style={s.action}>
            <ActionTile
              title={signup ? "Create account" : "Sign in"}
              disabled={busy}
              onPress={() => void submit()}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setSignup(!signup);
              setError("");
              setNotice("");
            }}
          >
            <Text style={s.link}>
              {signup
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </Text>
          </Pressable>
          {demoBuild && (
            <View style={s.demoActions}>
              {[1, 2, 3].map((n) => (
                <ActionTile
                  key={n}
                  title={`Play as ${["Alex", "Maya", "Sam"][n - 1]}`}
                  disabled={busy}
                  onPress={() => void submit(n)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f1f6ed" },
  page: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 16 },
  brand: {
    fontSize: 38,
    fontWeight: "800",
    color: "#244c37",
    textAlign: "center",
  },
  tagline: { textAlign: "center", color: "#667b65", marginBottom: 24 },
  card: { backgroundColor: "#fff", padding: 24, borderRadius: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: "700", color: "#244c37" },
  muted: { color: "#667b65", lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: "#dce4da",
    borderRadius: 12,
    padding: 14,
  },
  action: { alignItems: "center" },
  demoActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  link: { color: "#365d3d", textAlign: "center", padding: 8 },
  error: { color: "#a34d42", lineHeight: 22 },
});
