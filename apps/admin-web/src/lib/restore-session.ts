import axios from "axios";
import { useAuth } from "../stores/auth";
import { isPlatformConsole } from "./console";

/** New tabs restore their console's HttpOnly cookie without sharing access tokens in localStorage. */
export async function restoreSession(client: Pick<typeof axios, "post" | "get"> = axios): Promise<void> {
  const headers = { "X-FII-Console": isPlatformConsole ? "platform" : "tenant" };
  const { data } = await client.post("/api/v1/auth/refresh", {}, { withCredentials: true, headers });
  const { data: profile } = await client.get("/api/v1/auth/me", {
    headers: { ...headers, Authorization: `Bearer ${data.accessToken}` }, withCredentials: true,
  });
  useAuth.getState().setSession({ user: profile, permissions: profile.permissions, accessToken: data.accessToken });
}
