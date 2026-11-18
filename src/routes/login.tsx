import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  clearPendingAdminOAuth,
  completeAdminOAuthLogin,
  createAdmin,
  completeSetup,
  getPendingAdminOAuth,
  getCurrentUser,
  getRemembered,
  homeFor,
  login,
  type LoginMode,
} from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getElectronBridge } from "@/lib/electron";
import { synchronize, resumeSync } from "@/lib/supabaseSync";
import { migrateLocalData } from "@/lib/migrate";
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL } from "@/lib/version";
import { InstallAppButton } from "@/components/gpm/InstallApp";
import { parseAuthIdentifier } from "@/lib/auth-identifier";
import { UserAgreementGate } from "@/components/gpm/UserAgreement";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/types";
import { fetchGpmAppContent } from "@/lib/gpm-app-content";

const DEFAULT_GPM_ABOUT_TEXT = `# What is GILNET GPM?

GILNET GPM (Guest & Property Management) is a complete hotel management solution by Gilbert C Ngoma.

## What it does

- Front Desk: Check-in, check-out, reservations & guest profiles
- Rooms: Real-time room status, cleaning & maintenance
- Billing: Automatic room, laundry, restaurant & bar charges
- Staff: Manage housekeeping, kitchen & front desk tasks
- Reports: Daily sales, occupancy & revenue reports

## Why GILNET?

Unlike expensive foreign systems, GILNET is affordable, easy to use, supports offline work for cached and local-first tasks, and is built for how Zambian hotels actually operate.

Secure. Fast.`;

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: `Login - ${APP_NAME}` },
      {
        name: "description",
        content: `Sign in to ${APP_NAME} to manage rooms, reservations and staff messages.`,
      },
      { property: "og:title", content: `Login - ${APP_NAME}` },
      { property: "og:description", content: `Sign in to manage your property with ${APP_NAME}.` },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  return (
    <UserAgreementGate>
      <LoginPageContent />
    </UserAgreementGate>
  );
}

function LoginPageContent() {
  const navigate = useNavigate();
  const [aboutText, setAboutText] = useState(DEFAULT_GPM_ABOUT_TEXT);
  const [aboutError, setAboutError] = useState("");
  const [mode, setMode] = useState<"login" | "create">("login");
  const [code, setCode] = useState("LUS001");
  const [identifier, setIdentifier] = useState("");
  const [loginMode, setLoginMode] = useState<LoginMode>("staff");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [propName, setPropName] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("Hotel");
  const [address, setAddress] = useState("Dola Hill, Zaffico Road");
  const [phone, setPhone] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [error, setError] = useState("");
  const [noUsers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"email" | "recovery" | null>(null);
  const [recoverySessionReady, setRecoverySessionReady] = useState(false);
  const [recoveryOptionsOpen, setRecoveryOptionsOpen] = useState(false);
  const [emailOtp, setEmailOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void fetchGpmAppContent()
      .then((content) => {
        if (active && content) {
          setAboutText(content.about_text);
          setAboutError("");
        }
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setAboutError(
          cause instanceof Error ? cause.message : "The GILNET About content could not be loaded.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const preparePasswordRecovery = useCallback(async () => {
    const storedError = sessionStorage.getItem("gilnet_password_recovery_error");
    if (storedError) {
      sessionStorage.removeItem("gilnet_password_recovery_error");
      throw new Error(storedError);
    }
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session?.user) {
      throw new Error("The password setup or reset link has expired. Request a new email.");
    }
    const user = data.session.user;
    const role = await supabase
      .from("user_roles")
      .select("property_code, role")
      .eq("user_id", user.id)
      .single();
    if (role.error) throw role.error;
    if (!user.email) throw new Error("The account reset link has no login email.");

    const isManagement = ["Admin", "Manager", "Supervisor"].includes(role.data.role);
    setCode(isManagement ? role.data.property_code : "");
    setIdentifier(user.email);
    setLoginMode(isManagement ? "management" : "staff");
    setConfirmation("recovery");
    setRecoverySessionReady(true);
    setStatus(
      isManagement
        ? "Choose a new password to finish account recovery."
        : "Enter your property code and choose a new password.",
    );
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (url.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery") {
      return;
    }
    const current = getCurrentUser();
    if (current) {
      navigate({ to: homeFor(current.role), replace: true });
      return;
    }
    const r = getRemembered();
    if (r) {
      setCode(r.property_code);
      setIdentifier(r.email);
      setLoginMode(r.mode ?? (r.email.includes("@") ? "management" : "staff"));
      setRemember(true);
    }
  }, [navigate]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    if (url.searchParams.get("type") !== "recovery" && hashParams.get("type") !== "recovery") {
      return;
    }

    let active = true;
    void (async () => {
      await preparePasswordRecovery();
      if (active) window.history.replaceState(null, "", url.pathname);
    })().catch((cause) => {
      if (active) {
        setError(cause instanceof Error ? cause.message : "Could not open the account setup link.");
      }
    });

    return () => {
      active = false;
    };
  }, [preparePasswordRecovery]);

  const resetFormFeedback = () => {
    setError("");
    setStatus("");
    setConfirmation(null);
    setRecoverySessionReady(false);
    setRecoveryOptionsOpen(false);
    setPassword("");
    setEmailOtp("");
    setNewPassword("");
    setConfirmNewPassword("");
  };

  const finishSignIn = useCallback(
    async (session: Awaited<ReturnType<typeof login>>) => {
      migrateLocalData(session.property_code);
      resumeSync();
      await synchronize();
      navigate({ to: homeFor(session.role), replace: true });
    },
    [navigate],
  );

  useEffect(() => {
    let active = true;
    let handled = false;
    let removeElectronListener: (() => void) | null = null;
    let removeNativeListener: (() => Promise<void>) | null = null;
    let listenerSetupCancelled = false;
    let pending: ReturnType<typeof getPendingAdminOAuth>;
    try {
      pending = getPendingAdminOAuth();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved sign-in state is invalid.");
      return;
    }

    const handleCallback = async (callbackUrl: string) => {
      if (!active || handled) return;
      try {
        const url = new URL(callbackUrl);
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
        if (url.searchParams.get("type") === "recovery" || hashParams.get("type") === "recovery") {
          return;
        }
        const savedState = getPendingAdminOAuth();
        if (!savedState) return;
        if (Capacitor.isNativePlatform() && url.protocol !== "gilnet:") return;
        if (url.protocol === "gilnet:" && (url.hostname !== "auth" || url.pathname !== "/callback"))
          return;
        handled = true;
        setBusy(true);
        setError("");
        if (url.protocol === "gilnet:") {
          const providerError =
            url.searchParams.get("error_description") || url.searchParams.get("error");
          if (providerError) throw new Error(providerError);
          const code = url.searchParams.get("code");
          if (!code) throw new Error("The provider did not return a sign-in code.");
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          if (!data.session)
            throw new Error("The provider did not create a GILNET sign-in session.");
        } else {
          if (url.origin !== window.location.origin || url.pathname !== "/login") {
            throw new Error("The provider returned to an unexpected GILNET address.");
          }
          const providerError =
            url.searchParams.get("error_description") || url.searchParams.get("error");
          if (providerError) throw new Error(providerError);
          if (!url.searchParams.has("code"))
            throw new Error("The provider did not return a sign-in code.");
          const { data, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (!data.session)
            throw new Error("The provider did not create a GILNET sign-in session.");
          window.history.replaceState(null, "", "/login");
        }
        const session = await completeAdminOAuthLogin();
        await finishSignIn(session);
      } catch (cause) {
        clearPendingAdminOAuth();
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not complete provider sign-in.");
          setBusy(false);
        }
      }
    };

    const electronBridge = getElectronBridge();
    if (Capacitor.isNativePlatform()) {
      void App.addListener("appUrlOpen", ({ url }) => void handleCallback(url))
        .then((listener) => {
          if (listenerSetupCancelled) void listener.remove();
          else removeNativeListener = () => listener.remove();
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not listen for the provider callback.",
            );
        });
      void App.getLaunchUrl()
        .then((launch) => {
          if (launch?.url) void handleCallback(launch.url);
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error ? cause.message : "Could not read the provider callback.",
            );
        });
    } else if (electronBridge) {
      void electronBridge
        .onAuthCallback((url) => void handleCallback(url))
        .then((unsubscribe) => {
          if (listenerSetupCancelled) unsubscribe();
          else removeElectronListener = unsubscribe;
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not listen for the provider callback.",
            );
        });
    } else if (pending) {
      const callbackUrl = new URL(window.location.href);
      if (
        callbackUrl.pathname === "/login" &&
        (callbackUrl.searchParams.has("code") || callbackUrl.searchParams.has("error"))
      ) {
        void handleCallback(callbackUrl.href);
      }
    }

    return () => {
      active = false;
      listenerSetupCancelled = true;
      removeElectronListener?.();
      if (removeNativeListener) void removeNativeListener();
    };
  }, [finishSignIn]);

  const verifyEmail = async () => {
    setError("");
    setBusy(true);
    try {
      const authIdentifier = parseAuthIdentifier(identifier);
      if (!("email" in authIdentifier) || !authIdentifier.email) {
        throw new Error("Enter the email address that received the confirmation code.");
      }
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: authIdentifier.email,
        token: emailOtp.trim(),
        type: "signup",
      });
      if (verifyError) throw verifyError;
      if (mode === "create") {
        await completeSetup(code, {
          name: propName,
          address,
          phone,
          billing_email: billingEmail,
          property_type: propertyType,
        });
      }
      const session = await login(
        code,
        identifier,
        password,
        remember,
        mode === "login" ? loginMode : undefined,
      );
      setConfirmation(null);
      await finishSignIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify the email address.");
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const authIdentifier = parseAuthIdentifier(identifier);
      if (!("email" in authIdentifier))
        throw new Error("Enter your account login email address first.");
      const redirectTo =
        Capacitor.isNativePlatform() || getElectronBridge()
          ? "gilnet://auth/callback"
          : `${window.location.origin}/login?type=recovery`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        authIdentifier.email,
        {
          redirectTo,
        },
      );
      if (resetError) throw resetError;
      setConfirmation("recovery");
      setRecoverySessionReady(false);
      setRecoveryOptionsOpen(false);
      setEmailOtp("");
      setNewPassword("");
      setConfirmNewPassword("");
      setStatus(
        `A secure password reset link was sent to ${authIdentifier.email}. Open it within 10 minutes to choose a new password.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the password reset link.");
    } finally {
      setBusy(false);
    }
  };

  const enterEmailConfirmation = () => {
    setError("");
    setStatus("");
    setEmailOtp("");
    setConfirmation("email");
  };

  const resendEmailConfirmation = async () => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const authIdentifier = parseAuthIdentifier(identifier);
      if (!("email" in authIdentifier)) throw new Error("Enter the management email address.");
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: authIdentifier.email,
      });
      if (resendError) throw resendError;
      setStatus(`A new six-digit confirmation code was sent to ${authIdentifier.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the confirmation code.");
    } finally {
      setBusy(false);
    }
  };

  const verifyPasswordReset = async () => {
    setError("");
    setBusy(true);
    try {
      const authIdentifier = parseAuthIdentifier(identifier);
      if (!("email" in authIdentifier)) throw new Error("Enter your account login email address.");
      if (!recoverySessionReady)
        throw new Error("Open the secure password reset link from your email first.");
      if (newPassword.length < 8) throw new Error("Choose a password with at least 8 characters.");
      if (newPassword !== confirmNewPassword) throw new Error("The passwords do not match.");
      const { data: currentUser, error: currentUserError } = await supabase.auth.getUser();
      if (currentUserError || !currentUser.user) {
        throw currentUserError ?? new Error("Could not verify the account for this reset.");
      }
      const roleResult = await supabase
        .from("user_roles")
        .select("property_code, role")
        .eq("user_id", currentUser.user.id)
        .single();
      if (roleResult.error) throw roleResult.error;
      if (roleResult.data.property_code !== code.trim().toUpperCase()) {
        throw new Error("This account belongs to a different property.");
      }
      const isManagement = ["Admin", "Manager", "Supervisor"].includes(roleResult.data.role);
      setLoginMode(isManagement ? "management" : "staff");
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      const session = await login(
        code,
        identifier,
        newPassword,
        remember,
        isManagement ? "management" : "staff",
      );
      setConfirmation(null);
      setRecoverySessionReady(false);
      setPassword(newPassword);
      await finishSignIn(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (confirmation === "email") {
      await verifyEmail();
      return;
    }
    if (confirmation === "recovery") {
      await verifyPasswordReset();
      return;
    }
    setConfirmation(null);
    setBusy(true);
    try {
      if (mode === "create") {
        if (!name || !identifier || password.length < 8 || !propName || !billingEmail)
          throw new Error("Fill in all fields (password at least 8 characters).");
        if (!parseAuthIdentifier(identifier).email)
          throw new Error("Create the first administrator account with an email address.");
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user)
          await completeSetup(code, {
            name: propName,
            address,
            phone,
            billing_email: billingEmail,
            property_type: propertyType,
          });
        else {
          const result = await createAdmin({
            code,
            name,
            identifier,
            username: username || (identifier.split("@")[0] ?? identifier),
            password,
            property: {
              name: propName,
              address,
              phone,
              billing_email: billingEmail,
              property_type: propertyType,
            },
          });
          if (!result.signedIn) {
            setConfirmation(result.confirmation);
            return;
          }
        }
      } else {
        const authIdentifier = parseAuthIdentifier(identifier);
        if (loginMode === "management" && !("email" in authIdentifier)) {
          throw new Error("Enter your administrator, manager or supervisor email address.");
        }
        if (loginMode === "staff" && !("email" in authIdentifier)) {
          throw new Error("Enter your staff email address.");
        }
        if (loginMode === "staff" && password.length < 8) {
          throw new Error("Staff passwords must contain at least 8 characters.");
        }
      }
      const s = await login(
        code,
        identifier,
        password,
        remember,
        mode === "login" ? loginMode : undefined,
      );
      await finishSignIn(s);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not sign in.";
      if (mode === "login" && loginMode === "management" && /email not confirmed/i.test(message)) {
        setConfirmation("email");
        setRecoveryOptionsOpen(false);
        setEmailOtp("");
        setStatus("Enter the six-digit confirmation code sent to your email.");
        setError("");
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gpm-login-shell flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <form
        onSubmit={submit}
        className="gpm-login-card w-full max-w-md rounded-3xl border border-brand-border bg-brand-soft p-8 shadow-sm"
      >
        <div className="mb-6 text-center">
          <img
            src="/gilnet-logo.png"
            alt={APP_NAME}
            width={80}
            height={80}
            className="mx-auto rounded-2xl"
          />
          <h1 className="mt-3 text-2xl font-extrabold">{APP_NAME}</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login"
              ? "Choose your sign-in type to continue"
              : "Create the first Admin account"}
          </p>
        </div>
        <div className="space-y-3">
          {(confirmation !== "recovery" || recoverySessionReady) && (
            <div>
              <Label htmlFor="code">Property Code</Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="LUS001"
              />
            </div>
          )}
          {mode === "create" && (
            <>
              <div>
                <Label htmlFor="pn">Property Name</Label>
                <Input
                  id="pn"
                  value={propName}
                  onChange={(e) => setPropName(e.target.value)}
                  placeholder="Lusaka Suites"
                />
              </div>
              <div>
                <Label htmlFor="property-type">Property type</Label>
                <select
                  id="property-type"
                  value={propertyType}
                  onChange={(event) => {
                    const selected = PROPERTY_TYPES.find((type) => type === event.target.value);
                    if (selected) setPropertyType(selected);
                  }}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                >
                  {PROPERTY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  This sets whether your dashboard lists rooms or apartment units.
                </p>
              </div>
              <div>
                <Label htmlFor="addr">Address</Label>
                <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ph">Phone</Label>
                <Input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="billing-email">Property billing email</Label>
                <Input
                  id="billing-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={billingEmail}
                  onChange={(e) => setBillingEmail(e.target.value)}
                  placeholder="billing@property.com"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This property contact is separate from individual staff and user sign-ins.
                </p>
              </div>
              <div>
                <Label htmlFor="nm">Your Name</Label>
                <Input id="nm" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="un">Username</Label>
                <Input
                  id="un"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                />
              </div>
            </>
          )}
          {mode === "login" && confirmation === null && (
            <div role="group" aria-label="Sign-in type" className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={loginMode === "staff" ? "default" : "outline"}
                className="rounded-full text-xs sm:text-sm"
                onClick={() => {
                  setLoginMode("staff");
                  setIdentifier("");
                  resetFormFeedback();
                }}
              >
                Staff
              </Button>
              <Button
                type="button"
                variant={loginMode === "management" ? "default" : "outline"}
                className="rounded-full text-xs sm:text-sm"
                onClick={() => {
                  setLoginMode("management");
                  setIdentifier("");
                  resetFormFeedback();
                }}
              >
                Management
              </Button>
            </div>
          )}
          {mode === "login" && confirmation === null && (
            <p className="rounded-xl border border-brand-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
              {loginMode === "staff"
                ? "Staff sign in with their email and password."
                : "Sign in with your email and password."}
            </p>
          )}
          <div>
            <Label htmlFor="identifier">
              {mode === "create"
                ? "Email address"
                : loginMode === "staff"
                  ? "Staff email address"
                  : "Email address"}
            </Label>
            <Input
              id="identifier"
              type="email"
              inputMode="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              readOnly={confirmation === "recovery"}
              autoComplete="username"
              placeholder={
                mode === "create"
                  ? "name@example.com"
                  : loginMode === "staff"
                    ? "staff@example.com"
                    : "name@example.com"
              }
            />
          </div>
          {confirmation !== "recovery" && (
            <div>
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
              />
            </div>
          )}
          {confirmation === "recovery" && (
            <>
              {recoverySessionReady ? (
                <>
                  <div>
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose a password with at least 8 characters.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="confirm-new-password">Confirm new password</Label>
                    <Input
                      id="confirm-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <p role="status" className="text-sm text-primary">
                  Check your email and open the secure reset link to choose a new password.
                </p>
              )}
            </>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
              aria-label="Remember my login info"
            />
            Remember my login information
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {confirmation === "email" && (
            <>
              <p role="status" className="text-sm text-primary">
                Enter the six-digit code sent to this email address.
              </p>
              <div>
                <Label htmlFor="email-confirmation-otp">Email confirmation code</Label>
                <Input
                  id="email-confirmation-otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              <Button
                type="button"
                variant="link"
                className="w-full"
                disabled={busy}
                onClick={() => void resendEmailConfirmation()}
              >
                Resend confirmation code
              </Button>
            </>
          )}
          {status && (
            <p role="status" className="text-sm text-primary">
              {status}
            </p>
          )}
          <Button
            type="submit"
            className="w-full rounded-full"
            size="lg"
            disabled={
              busy ||
              (confirmation === "email" && !/^\d{6}$/.test(emailOtp.trim())) ||
              (confirmation === "recovery" && !recoverySessionReady)
            }
          >
            {busy
              ? "Please wait…"
              : confirmation === "email"
                ? "Confirm email"
                : confirmation === "recovery"
                  ? recoverySessionReady
                    ? loginMode === "staff"
                      ? "Set password"
                      : "Reset password"
                    : "Open reset link from email"
                  : mode === "login"
                    ? "Sign in"
                    : "Create Admin Account"}
          </Button>
          {mode === "login" && confirmation === null && (
            <>
              <Button
                type="button"
                variant="link"
                className="w-full"
                disabled={busy}
                aria-expanded={recoveryOptionsOpen}
                onClick={() => setRecoveryOptionsOpen((open) => !open)}
              >
                Forgot password?
              </Button>
              {recoveryOptionsOpen && (
                <>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full"
                    disabled={busy}
                    onClick={() => void requestPasswordReset()}
                  >
                    Send a password reset email
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    className="w-full"
                    disabled={busy}
                    onClick={enterEmailConfirmation}
                  >
                    I have an email confirmation code
                  </Button>
                </>
              )}
            </>
          )}
          {mode === "login" && noUsers && (
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full"
              onClick={() => {
                resetFormFeedback();
                setIdentifier("");
                setMode("create");
              }}
            >
              First time? Create Admin Account
            </Button>
          )}
          {mode === "create" && (
            <button
              type="button"
              className="w-full text-sm text-primary"
              onClick={() => {
                resetFormFeedback();
                setMode("login");
              }}
            >
              Back to login
            </button>
          )}
          {mode === "login" && (confirmation === "email" || confirmation === "recovery") && (
            <Button type="button" variant="link" className="w-full" onClick={resetFormFeedback}>
              Back to sign in
            </Button>
          )}
        </div>
        <div className="mt-5">
          <InstallAppButton className="w-full" />
        </div>
        <p className="mt-6 text-center text-[11px] text-muted-foreground">
          Support:{" "}
          <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          <br />
          <Link className="underline" to="/guide">
            First-time Guide
          </Link>
          <br />
          Version {APP_VERSION}
          <br />© 2026 GILNET by Gilbert. All Rights Reserved.
        </p>
      </form>
      <details className="w-full max-w-3xl">
        <summary className="mx-auto w-fit cursor-pointer list-none rounded-full border border-brand-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          About GILNET
        </summary>
        <section
          aria-labelledby="about-gilnet"
          className="mt-3 space-y-3 rounded-3xl border border-brand-border bg-card p-6 shadow-sm"
        >
          <div id="about-gilnet">{renderManagedAboutText(aboutText)}</div>
          {aboutError && (
            <p role="alert" className="text-xs text-destructive">
              Showing bundled About content because the latest version could not be loaded:{" "}
              {aboutError}
            </p>
          )}
        </section>
      </details>
    </div>
  );
}

function renderManagedAboutText(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (block.startsWith("# ")) {
        return (
          <h2 key={`${index}-${block}`} className="text-xl font-bold">
            {block.slice(2)}
          </h2>
        );
      }
      if (block.startsWith("## ")) {
        return (
          <h3 key={`${index}-${block}`} className="font-semibold">
            {block.slice(3)}
          </h3>
        );
      }
      const lines = block.split(/\r?\n/);
      if (lines.every((line) => line.startsWith("- "))) {
        return (
          <ul
            key={`${index}-${block}`}
            className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"
          >
            {lines.map((line) => (
              <li key={line}>{line.slice(2)}</li>
            ))}
          </ul>
        );
      }
      return (
        <p key={`${index}-${block}`} className="text-sm text-muted-foreground">
          {block}
        </p>
      );
    });
}
