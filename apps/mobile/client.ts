import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { makeClient, createApi } from "@treequest/shared";

export const url =
  process.env.EXPO_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
export const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";
export const configured = !!process.env.EXPO_PUBLIC_SUPABASE_URL && !!key;
export const client = makeClient(url, key || "not-configured", {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
export const api = createApi(client, url, key, Crypto.randomUUID);
export const demoBuild = __DEV__ && process.env.EXPO_PUBLIC_APP_MODE === "demo";
