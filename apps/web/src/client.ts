import { makeClient, createApi } from "@treequest/shared";
export const url =
  import.meta.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
export const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const client = makeClient(url, key || "not-configured");
export const api = createApi(client, url, key);
export const devDemo =
  import.meta.env.DEV && import.meta.env.VITE_APP_MODE === "demo";
