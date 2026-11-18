import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";
import { initializeAuth, loadIdentity } from '@/lib/auth';
import { supabase } from '@/integrations/supabase/client';
import { startSyncLoop, stopSync, resumeSync } from '@/lib/supabaseSync';
import { registerOfflineApp } from '@/lib/pwa';
import { InstallAppProvider } from '@/components/gpm/InstallApp';
import { APP_NAME } from "@/lib/version";
import { getElectronBridge } from "@/lib/electron";
import { keys, remove } from "@/lib/db";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "description", content: `Offline-first property management by ${APP_NAME}.` },
      { name: "author", content: APP_NAME },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-512.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(()=>{
    if (Capacitor.isNativePlatform()) {
      void SplashScreen.hide().catch((error: unknown) => {
        console.error("Could not hide the native splash screen after startup.", error);
      });
    }
    void registerOfflineApp();
    void initializeAuth().then(()=>startSyncLoop());
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(!['SIGNED_IN','SIGNED_OUT','USER_UPDATED'].includes(event))return;
      if(event==='SIGNED_OUT'){stopSync();remove(keys.session);queryClient.clear();}
      else setTimeout(()=>void loadIdentity().then(()=>resumeSync()),0);
      void router.invalidate();
      if(event!=='SIGNED_OUT')void queryClient.invalidateQueries();
    });
    return ()=>subscription.unsubscribe();
  },[queryClient,router]);

  useEffect(() => {
    let active = true;
    let handledUrl = "";
    let removeNativeListener: (() => Promise<void>) | null = null;
    let removeElectronListener: (() => void) | null = null;
    let listenerSetupCancelled = false;

    const handleRecoveryCallback = async (callbackUrl: string) => {
      let url: URL;
      try {
        url = new URL(callbackUrl);
      } catch {
        return;
      }
      if (url.protocol !== "gilnet:" || url.hostname !== "auth" || url.pathname !== "/callback") {
        return;
      }
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errorCode = url.searchParams.get("error_code") ?? hashParams.get("error_code");
      const isRecovery =
        url.searchParams.get("type") === "recovery" ||
        hashParams.get("type") === "recovery" ||
        errorCode?.startsWith("otp_") === true;
      if (!isRecovery || !active || handledUrl === url.href) return;
      handledUrl = url.href;

      try {
        const callbackError =
          url.searchParams.get("error_description") ||
          url.searchParams.get("error") ||
          hashParams.get("error_description") ||
          hashParams.get("error");
        if (callbackError) throw new Error(callbackError);

        const accessToken = url.searchParams.get("access_token") ?? hashParams.get("access_token");
        const refreshToken = url.searchParams.get("refresh_token") ?? hashParams.get("refresh_token");
        const code = url.searchParams.get("code");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          if (!data.session)
            throw new Error("The password setup or reset link is invalid or expired.");
        }
        sessionStorage.removeItem("gilnet_password_recovery_error");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The password setup or reset link is invalid or expired.";
        sessionStorage.setItem("gilnet_password_recovery_error", message);
      }

      window.location.assign("/login?type=recovery");
    };

    if (Capacitor.isNativePlatform()) {
      void App.addListener("appUrlOpen", ({ url }) => void handleRecoveryCallback(url))
        .then((listener) => {
          if (listenerSetupCancelled) void listener.remove();
          else removeNativeListener = () => listener.remove();
        })
        .catch((error: unknown) => {
          console.error("Could not listen for password setup links.", error);
        });
      void App.getLaunchUrl()
        .then((launch) => {
          if (launch?.url) void handleRecoveryCallback(launch.url);
        })
        .catch((error: unknown) => {
          console.error("Could not read the password setup link.", error);
        });
    } else {
      const electronBridge = getElectronBridge();
      if (electronBridge) {
        void electronBridge
          .onAuthCallback((url) => void handleRecoveryCallback(url))
          .then((unsubscribe) => {
            if (listenerSetupCancelled) unsubscribe();
            else removeElectronListener = unsubscribe;
          })
          .catch((error: unknown) => {
            console.error("Could not listen for password setup links.", error);
          });
      }
    }

    return () => {
      active = false;
      listenerSetupCancelled = true;
      removeElectronListener?.();
      if (removeNativeListener) void removeNativeListener();
    };
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <InstallAppProvider><Outlet /></InstallAppProvider>
          <Toaster position="top-center" />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
