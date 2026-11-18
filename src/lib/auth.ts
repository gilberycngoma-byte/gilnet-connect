import { supabase } from "@/integrations/supabase/client";
import { hydrateLocalStorageFromIndexedDB, keys, read, remove, write, useStored } from "./db";
import { deptForRole, type Property, type Role } from "./types";
import { parseAuthIdentifier } from "./auth-identifier";
export type Session = {
  property_code: string;
  user_email: string;
  user_name: string;
  role: Role;
  login_time: string;
  remember: boolean;
  token: string;
  staff_id?: string;
  department?: string;
};
export type Remembered = { property_code: string; email: string; remember: true; mode?: LoginMode };
export type LoginMode = "staff" | "management";
export type AdminOAuthProvider = "github" | "google";
type PendingAdminOAuth = {
  provider: AdminOAuthProvider;
  propertyCode: string;
  remember: boolean;
};
const ADMIN_OAUTH_STATE_KEY = "gilnet_pending_admin_oauth";
export const enc = (s: string) => s;
export const dec = (s: string) => s;
export const getUsers = (_code: string) => [];
export function isLoginModeAllowed(role: Role, mode: LoginMode) {
  const isManagement = role === "Admin" || role === "Manager" || role === "Supervisor";
  return mode === "management" ? isManagement : !isManagement;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
async function authFunctionError(error: { message: string; context?: unknown }): Promise<Error> {
  if (error.context instanceof Response) {
    const body: unknown = await error.context
      .clone()
      .json()
      .catch(() => undefined);
    if (isRecord(body)) {
      if (body["locked"] === true && typeof body["retry_after_seconds"] === "number") {
        const minutes = Math.max(1, Math.ceil(body["retry_after_seconds"] / 60));
        const credential = body["credential"] === "PIN" ? "PIN" : "password";
        const unit = minutes === 1 ? "minute" : "minutes";
        const resetOption = credential === "PIN" ? "reset your PIN" : "reset your password";
        return new Error(
          `Too many incorrect ${credential} attempts. Try again in about ${minutes} ${unit}, contact GILNET Support, or ask your property admin to ${resetOption}.`,
        );
      }
      if (typeof body["error"] === "string") return new Error(body["error"]);
    }
  }
  return new Error(error.message);
}
function valid(s: Session | null): s is Session {
  return (
    !!s &&
    typeof s.property_code === "string" &&
    typeof s.user_email === "string" &&
    typeof s.user_name === "string" &&
    typeof s.login_time === "string" &&
    Number.isFinite(Date.parse(s.login_time)) &&
    typeof s.token === "string"
  );
}
export function getCurrentUser() {
  const s = read<Session | null>(keys.session, null);
  return valid(s) ? s : null;
}
export const isLoggedIn = () => !!getCurrentUser();
export function useSession() {
  const s = useStored<Session | null>(keys.session, null);
  return valid(s) ? s : null;
}
export const getRemembered = () => read<Remembered | null>(keys.remembered, null);
export const clearRemembered = () => remove(keys.remembered);
export function setRememberSession(on: boolean) {
  const s = getCurrentUser();
  if (s) write(keys.session, { ...s, remember: on });
}
export async function loadIdentity(remember = true, expectedCode?: string) {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  const role = await supabase.from("user_roles").select("*").eq("user_id", user.id).maybeSingle();
  if (!role.data) return null;
  if (expectedCode && role.data.property_code !== expectedCode.trim().toUpperCase())
    throw new Error("This account belongs to a different property.");
  const profile = await supabase.from("profiles").select("*").eq("id", user.id).single();
  const property = await supabase
    .from("properties")
    .select("*")
    .eq("code", role.data.property_code)
    .single();
  if (property.data) write(keys.property(role.data.property_code), property.data, false);
  const previous = getCurrentUser();
  const metadata = user.user_metadata ?? {};
  const s: Session = {
    property_code: role.data.property_code,
    user_email:
      typeof metadata["company_email"] === "string"
        ? metadata["company_email"]
        : (user.email ?? user.phone ?? ""),
    user_name: profile.data?.name ?? user.email ?? user.phone ?? "Staff",
    role: role.data.role as Role,
    login_time: previous?.token === user.id ? previous.login_time : new Date().toISOString(),
    remember,
    token: user.id,
    staff_id: user.id,
    department:
      typeof metadata["department"] === "string"
        ? metadata["department"]
        : deptForRole(role.data.role),
  };
  write(keys.session, s, false);
  return s;
}
function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export async function createAdmin(input: {
  code: string;
  name: string;
  identifier: string;
  username: string;
  password: string;
  property: Property;
}) {
  const storage = getSessionStorage();
  if (storage) {
    storage.setItem("gilnet_pending_setup", JSON.stringify(input.property));
    storage.setItem("gilnet_pending_code", input.code.toUpperCase());
  }
  try {
    const authIdentifier = parseAuthIdentifier(input.identifier);
    if (!("email" in authIdentifier))
      throw new Error("Administrator accounts must use an email address.");
    const { data, error } = await supabase.auth.signUp({
      email: authIdentifier.email,
      password: input.password,
      options: {
        data: { name: input.name, username: input.username },
      },
    });
    if (error) throw error;
    return {
      signedIn: !!data.session,
      confirmation: data.session ? null : ("email" as const),
    };
  } catch (error) {
    storage?.removeItem("gilnet_pending_setup");
    storage?.removeItem("gilnet_pending_code");
    throw error;
  }
}
export async function completeSetup(code: string, property: Property) {
  const result = property.billing_email?.trim()
    ? await supabase.rpc("gpm_setup_with_billing", {
        p_code: code,
        p_name: property.name,
        p_address: property.address,
        p_phone: property.phone,
        p_billing_email: property.billing_email.trim(),
        p_property_type: property.property_type ?? "Hotel",
      })
    : await supabase.rpc("gpm_setup", {
        p_code: code,
        p_name: property.name,
        p_address: property.address,
        p_phone: property.phone,
      });
  if (result.error) throw result.error;
  const storage = getSessionStorage();
  if (storage) {
    storage.removeItem("gilnet_pending_setup");
    storage.removeItem("gilnet_pending_code");
  }
}
export async function login(
  code: string,
  identifier: string,
  password: string,
  remember: boolean,
  mode?: LoginMode,
) {
  const authIdentifier = parseAuthIdentifier(identifier);
  if (mode === "staff" && !("email" in authIdentifier))
    throw new Error("Staff accounts must sign in with an email address.");
  const { data, error } = await supabase.functions.invoke<{
    access_token: string;
    refresh_token: string;
  }>("password-login", {
    body: { ...authIdentifier, password },
  });
  if (error) throw await authFunctionError(error);
  if (typeof data?.access_token !== "string" || typeof data.refresh_token !== "string") {
    throw new Error("The password sign-in service returned an invalid session.");
  }
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (sessionError) throw sessionError;
  let s = await loadIdentity(remember, code);
  const storage = getSessionStorage();
  const pending = storage?.getItem("gilnet_pending_setup");
  if (!s && pending && storage?.getItem("gilnet_pending_code") === code.toUpperCase()) {
    await completeSetup(code, JSON.parse(pending));
    s = await loadIdentity(remember, code);
  }
  if (!s)
    throw new Error(
      "Your account is not assigned to a property yet. Complete first-time setup or contact your administrator.",
    );
  if (mode && !isLoginModeAllowed(s.role, mode)) {
    await logout();
    throw new Error(
      mode === "staff"
        ? "This is a management account. Choose “Management.”"
        : "This is a staff account. Choose “Staff.”",
    );
  }
  if (remember)
    write(
      keys.remembered,
      {
        property_code: code.toUpperCase(),
        email: identifier.trim(),
        remember: true,
        mode: mode ?? (isLoginModeAllowed(s.role, "management") ? "management" : "staff"),
      },
      false,
    );
  else clearRemembered();
  return s;
}
export async function logout() {
  remove(keys.session);
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
}
function adminOAuthStorage(): Storage {
  const storage = getSessionStorage();
  if (!storage)
    throw new Error(
      "This browser cannot securely keep the sign-in state. Enable session storage and try again.",
    );
  return storage;
}
function isPendingAdminOAuth(value: unknown): value is PendingAdminOAuth {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    (state["provider"] === "github" || state["provider"] === "google") &&
    typeof state["propertyCode"] === "string" &&
    typeof state["remember"] === "boolean"
  );
}
export async function beginAdminOAuth(
  provider: AdminOAuthProvider,
  propertyCode: string,
  remember: boolean,
  redirectTo: string,
) {
  const code = propertyCode.trim().toUpperCase();
  if (!code) throw new Error("Enter your property code before using GitHub or Google sign-in.");
  const storage = adminOAuthStorage();
  storage.setItem(
    ADMIN_OAUTH_STATE_KEY,
    JSON.stringify({ provider, propertyCode: code, remember }),
  );
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
      },
    });
    if (error) throw error;
    if (!data.url)
      throw new Error("Supabase did not return a sign-in URL. Check the provider configuration.");
    return data.url;
  } catch (error) {
    storage.removeItem(ADMIN_OAUTH_STATE_KEY);
    throw error;
  }
}
export function getPendingAdminOAuth(): PendingAdminOAuth | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(ADMIN_OAUTH_STATE_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (isPendingAdminOAuth(value)) {
      const state = value;
      return { ...state, propertyCode: state.propertyCode.trim().toUpperCase() };
    }
  } catch {
    storage.removeItem(ADMIN_OAUTH_STATE_KEY);
    throw new Error("The saved sign-in state is invalid. Start again from the login screen.");
  }
  storage.removeItem(ADMIN_OAUTH_STATE_KEY);
  throw new Error("The saved sign-in state is invalid. Start again from the login screen.");
}
export function clearPendingAdminOAuth() {
  getSessionStorage()?.removeItem(ADMIN_OAUTH_STATE_KEY);
}
export async function completeAdminOAuthLogin(): Promise<Session> {
  const pending = getPendingAdminOAuth();
  if (!pending)
    throw new Error(
      "No pending GitHub or Google sign-in was found. Start again from the login screen.",
    );
  try {
    const session = await loadIdentity(pending.remember, pending.propertyCode);
    if (!session) {
      throw new Error(
        "This provider account is not assigned to a GILNET property. Ask the administrator to link your existing Admin account.",
      );
    }
    if (session.role !== "Admin") {
      throw new Error("GitHub and Google sign-in are limited to an existing GILNET Admin account.");
    }
    if (pending.remember) {
      write(
        keys.remembered,
        {
          property_code: pending.propertyCode,
          email: session.user_email,
          remember: true,
          mode: "management",
        },
        false,
      );
    } else {
      clearRemembered();
    }
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify the Admin account.";
    try {
      await logout();
    } catch (signOutError) {
      const detail =
        signOutError instanceof Error ? signOutError.message : "unknown sign-out error";
      throw new Error(`${message} Also could not clear the provider session: ${detail}`);
    }
    throw error;
  } finally {
    clearPendingAdminOAuth();
  }
}
export async function initializeAuth() {
  await hydrateLocalStorageFromIndexedDB();
  const storage = getSessionStorage();
  // Retire reversible device accounts without touching operational records.
  if (typeof localStorage !== "undefined") {
    for (const k of Object.keys(localStorage))
      if (
        k.startsWith("gilnet_users_") ||
        k === "gilnet_session" ||
        k === "gilnet_remembered_login_device"
      )
        localStorage.removeItem(k);
  }
  const s = read<Session | null>(keys.session, null);
  if (valid(s) && typeof navigator !== "undefined" && !navigator.onLine) return;
  if (s && !valid(s)) {
    await logout();
    return;
  }
  await loadIdentity(s?.remember ?? true);
}
export type Action =
  | "frontdesk"
  | "checkin"
  | "cancel"
  | "noshow"
  | "undo_noshow"
  | "checkout"
  | "service"
  | "notice_manage"
  | "reservation_add"
  | "rooms"
  | "housekeeping"
  | "room_clean"
  | "out_of_order"
  | "restaurant"
  | "sale_edit"
  | "menu_manage"
  | "reports"
  | "updates"
  | "billing"
  | "users"
  | "profile_edit"
  | "password"
  | "room_admin";

const MANAGERS: Role[] = ["Admin", "Manager", "Supervisor"];
const DESK: Role[] = [...MANAGERS, "Front Desk"];
const RULES: Record<Action, Role[]> = {
  frontdesk: DESK,
  checkin: DESK,
  cancel: DESK,
  noshow: DESK,
  checkout: DESK,
  service: DESK,
  notice_manage: DESK,
  reservation_add: DESK,
  reports: DESK,
  undo_noshow: MANAGERS,
  sale_edit: MANAGERS,
  updates: MANAGERS,
  billing: MANAGERS,
  users: MANAGERS,
  profile_edit: MANAGERS,
  password: MANAGERS,
  rooms: [...DESK, "Housekeeping", "Maintenance"],
  housekeeping: [...DESK, "Housekeeping"],
  room_clean: [...DESK, "Housekeeping", "Maintenance"],
  out_of_order: [...DESK, "Maintenance"],
  restaurant: [...DESK, "Restaurant"],
  menu_manage: [...MANAGERS, "Restaurant"],
  room_admin: ["Admin"],
};

/** First page a role should land on. */
export function homeFor(role?: Role): "/dashboard" | "/restaurant" | "/housekeeping" | "/messages" {
  if (role === "Restaurant") return "/restaurant";
  if (role === "Housekeeping") return "/housekeeping";
  return role ? "/dashboard" : "/messages";
}

/** Client-side visibility only; the database re-checks every change. */
export function can(role: Role | undefined, action: Action): boolean {
  return !!role && RULES[action].includes(role);
}
