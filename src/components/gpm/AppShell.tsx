import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import {
  BedDouble,
  CalendarCheck,
  Home,
  LayoutGrid,
  Megaphone,
  MessageSquare,
  Search,
  Bell,
  UtensilsCrossed,
  BarChart3,
  Brush,
  ConciergeBell,
  ShieldAlert,
  Users,
  Settings,
  CreditCard,
  Menu,
  MoreHorizontal,
  BookOpen,
} from "lucide-react";
import { can, homeFor, logout, useSession, type Action } from "@/lib/auth";
import { keys, useStored } from "@/lib/db";
import { supabase } from "@/integrations/supabase/client";
import { applyTheme, DEFAULT_APP_PREFERENCES, type AppPreferences } from "@/lib/app-preferences";
import { migrateLocalData } from "@/lib/migrate";
import { resolveSyncConflict, startSyncLoop, type SyncConflicts } from "@/lib/supabaseSync";
import {
  APP_NAME,
  APP_VERSION,
  SUPPORT_EMAIL,
  compareVersions,
  fetchLatestVersion,
} from "@/lib/version";
import { DEPARTMENTS, type Message, type Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import { InstallAppButton } from "./InstallApp";
import { PropertyHeader } from "./PropertyHeader";
import { CloudBackupRestorePrompt } from "./SupabaseBackupPanel";
import { initializePropertyFolder } from "@/lib/propertyFolder";
import { UserAgreementGate } from "@/components/gpm/UserAgreement";
import { SyncStatusNotice } from "./SyncStatusNotice";
import {
  fetchGpmSubscriptionExpiryReminder,
  type GpmSubscriptionExpiryReminder,
} from "@/lib/gpm-announcements";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function useUpdateAvailable() {
  const [avail, setAvail] = useState(false);
  useEffect(() => {
    // Passive release-metadata check; never auto-installs or reloads.
    fetchLatestVersion().then(
      (v) => v && setAvail(compareVersions(v.latestStable, APP_VERSION) > 0),
    );
  }, []);
  return avail;
}

export function useUnreadTotal(code: string) {
  let total = 0;
  for (const d of DEPARTMENTS) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const list = useStored<Message[]>(keys.messages(code, d), []);
    total += list.filter((m) => !m.is_read).length;
  }
  return total;
}

function SyncConflictReview({ code }: { code: string }) {
  const conflicts = useStored<SyncConflicts>(keys.syncConflicts(code), {});
  const entries = Object.entries(conflicts);
  if (!entries.length) return null;

  return (
    <section
      aria-label="Sync conflict review"
      className="mx-3 mb-4 rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-amber-950 sm:mx-4 md:mx-8 dark:bg-amber-950 dark:text-amber-50"
    >
      <h2 className="font-semibold">Review changes before syncing</h2>
      <p className="mt-1 text-sm">
        This record changed on another device. Choose which version to keep; neither version will be
        replaced until you decide.
      </p>
      <div className="mt-4 space-y-4">
        {entries.map(([key, conflict]) => (
          <article key={key} className="rounded-md border border-current/20 p-3">
            <h3 className="font-medium">
              {conflict.local.kind} · {conflict.local.id}
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <h4 className="mb-1 text-sm font-medium">This device</h4>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs text-foreground">
                  {conflict.local.deleted
                    ? "This device deleted this record."
                    : JSON.stringify(conflict.local.payload, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-medium">Cloud version</h4>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 text-xs text-foreground">
                  {!conflict.remoteLoaded
                    ? "Refreshing the latest cloud version…"
                    : !conflict.remote
                      ? "This record is missing from the cloud."
                      : conflict.remote.deleted
                        ? "This record was deleted in the cloud."
                        : JSON.stringify(conflict.remote.payload, null, 2)}
                </pre>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!conflict.remoteLoaded}
                onClick={() => resolveSyncConflict(key, "local")}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Keep this device&apos;s version
              </button>
              <button
                type="button"
                disabled={!conflict.remoteLoaded}
                onClick={() => resolveSyncConflict(key, "cloud")}
                className="rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use cloud version
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type NavItem = {
  to:
    | "/dashboard"
    | "/frontdesk"
    | "/housekeeping"
    | "/reservations"
    | "/restaurant"
    | "/reports"
    | "/notices"
    | "/messages"
    | "/staff"
    | "/attendance"
    | "/settings"
    | "/payment"
    | "/guide";
  label: string;
  icon: typeof Home;
  allow?: Action;
};
const SIDEBAR: NavItem[] = [
  { to: "/dashboard", label: "Rooms Dashboard", icon: LayoutGrid, allow: "rooms" },
  { to: "/frontdesk", label: "Front Desk", icon: ConciergeBell, allow: "frontdesk" },
  { to: "/housekeeping", label: "Housekeeping", icon: Brush, allow: "housekeeping" },
  { to: "/reservations", label: "Bookings", icon: BedDouble, allow: "frontdesk" },
  { to: "/restaurant", label: "Restaurant / POS", icon: UtensilsCrossed, allow: "restaurant" },
  { to: "/reports", label: "Reports", icon: BarChart3, allow: "reports" },
  { to: "/notices", label: "Tasks", icon: Megaphone },
  { to: "/messages", label: "Messages", icon: MessageSquare },
  { to: "/staff", label: "Staff Management", icon: Users, allow: "users" },
  { to: "/attendance", label: "Staff Attendance", icon: CalendarCheck },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/payment", label: "Payment", icon: CreditCard, allow: "billing" },
  { to: "/guide", label: "First-time Guide", icon: BookOpen },
];
const BOTTOM: NavItem[] = [
  { to: "/reservations", label: "Bookings", icon: CalendarCheck, allow: "frontdesk" },
  { to: "/notices", label: "Tasks", icon: Megaphone },
  { to: "/messages", label: "Messages", icon: MessageSquare },
];

export function AppShell(props: {
  children: ReactNode;
  title: string;
  allow?: Action;
  hidePageHeading?: boolean;
}) {
  return (
    <UserAgreementGate>
      <AppShellContent {...props} />
    </UserAgreementGate>
  );
}

function AppShellContent({
  children,
  title,
  allow,
  hidePageHeading,
}: {
  children: ReactNode;
  title: string;
  allow?: Action;
  hidePageHeading?: boolean;
}) {
  const hydrated = useHydrated();
  const session = useSession();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const code = session?.property_code ?? "";
  const staffId = session?.staff_id ?? session?.token ?? "";
  const preferences = useStored<AppPreferences>(
    keys.appPreferences(code, staffId),
    DEFAULT_APP_PREFERENCES,
  );
  const property = useStored<Property | null>(keys.property(code), null);
  const propertyImage = property?.profile_image_url || property?.image_url;
  const unread = useUnreadTotal(code);
  const updateAvail = useUpdateAvailable();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [browserOnline, setBrowserOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const nativeOnline = useStored<boolean | null>("gilnet_network_online", null);
  const online = Capacitor.isNativePlatform() ? (nativeOnline ?? browserOnline) : browserOnline;
  const [subscriptionReminder, setSubscriptionReminder] =
    useState<GpmSubscriptionExpiryReminder | null>(null);
  const [subscriptionReminderError, setSubscriptionReminderError] = useState("");
  const syncStatus = useStored<string>("gilnet_sync_status", "Connecting…");
  const displaySyncStatus =
    syncStatus === "Pending sync · sign in as the original message sender"
      ? "Pending sync"
      : syncStatus;
  const needsSignIn = [
    "Sign in again to sync changes.",
    "The signed-in account changed. Please sign in again to sync changes.",
  ].includes(displaySyncStatus);

  const signInAgain = async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Could not clear the stale sign-in session.", error);
      toast.error("Could not clear the current sign-in session. Please try again.");
    }
    await navigate({ to: "/login", replace: true });
  };

  useEffect(() => {
    if (!hydrated) return;
    if (!session) navigate({ to: "/login", replace: true });
    else {
      migrateLocalData(session.property_code);
      startSyncLoop();
      void initializePropertyFolder(
        session.property_code,
        property?.name ?? session.property_code,
      ).catch((error) => {
        console.error("Could not initialize the local property folder", error);
      });
    }
  }, [hydrated, session, property?.name, navigate]);

  useEffect(() => {
    if (hydrated && session) applyTheme(preferences.theme);
  }, [hydrated, session, preferences.theme]);

  useEffect(() => {
    if (!hydrated || !session || session.role !== "Admin" || !code) {
      setSubscriptionReminder(null);
      setSubscriptionReminderError("");
      return;
    }

    let active = true;
    const loadReminder = async () => {
      try {
        const {
          data: { session: authSession },
          error: authError,
        } = await supabase.auth.getSession();
        if (authError) throw authError;
        if (!authSession) {
          if (active) {
            setSubscriptionReminder(null);
            setSubscriptionReminderError("");
          }
          return;
        }
        const reminder = await fetchGpmSubscriptionExpiryReminder();
        if (!active) return;
        setSubscriptionReminder(reminder);
        setSubscriptionReminderError("");
      } catch (error: unknown) {
        if (!active) return;
        setSubscriptionReminder(null);
        setSubscriptionReminderError(
          error instanceof Error ? error.message : "The subscription reminder could not be loaded.",
        );
      }
    };

    void loadReminder();
    const interval = window.setInterval(() => void loadReminder(), 6 * 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [hydrated, session, code]);

  useEffect(() => {
    const updateOnline = () => setBrowserOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (property?.name) document.title = `${APP_NAME} - ${property.name}`;
  }, [property?.name, path]);

  if (!hydrated || !session)
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <img
          src="/gilnet-logo.png"
          alt={APP_NAME}
          width={120}
          height={120}
          className="animate-pulse"
        />
      </div>
    );

  return (
    <div className="gpm-mobile-shell flex min-h-screen bg-background">
      {can(session.role, "users") && <CloudBackupRestorePrompt propertyCode={code} />}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground p-4 md:flex">
        <PropertyHeader code={code} property={property} />
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
          Operations
        </p>
        <nav className="space-y-1">
          {SIDEBAR.filter((n) => !n.allow || can(session.role, n.allow)).map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent",
                path.startsWith(n.to) && "bg-sidebar-primary text-sidebar-primary-foreground",
              )}
            >
              <n.icon className="h-4 w-4" /> {n.label}
              {n.to === "/messages" && unread > 0 && (
                <span className="ml-auto rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                  {unread}
                </span>
              )}
              {n.to === "/settings" && updateAvail && (
                <span className="ml-auto h-2 w-2 rounded-full bg-brand-amber" />
              )}
            </Link>
          ))}
        </nav>
        <div className="mt-auto text-[11px] text-sidebar-foreground/70">
          <InstallAppButton className="mb-4 w-full" />
          <div className="flex flex-col items-center border-t border-sidebar-border pt-3 text-center">
            <img src="/gilnet-logo.png" alt="" width={26} height={26} className="mb-1 rounded-lg" />
            <p className="font-semibold">GILNET GPM CONNECT</p>
            <p>Version {APP_VERSION}</p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-[#1e4863] bg-gradient-to-r from-[#0b2b47] via-[#0d3551] to-[#0b6970] px-3 py-3 text-white shadow-sm md:gap-4 md:px-8 md:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,400px)_auto] lg:border-border lg:bg-card lg:text-foreground lg:shadow-none">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open all operations"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white hover:bg-white/10 md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <img
              src={propertyImage || "/gilnet-logo.png"}
              alt={propertyImage ? `${property?.name ?? "Property"} profile` : APP_NAME}
              width={40}
              height={40}
              className={cn(
                "h-10 w-10 shrink-0 object-cover",
                propertyImage ? "rounded-full" : "rounded-lg",
              )}
            />
            <div className="min-w-0">
              <p className="hidden truncate text-xl font-bold md:block">
                {property?.name ?? APP_NAME}
              </p>
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-white/75 md:hidden">
                {property?.name ?? APP_NAME}
              </p>
              <p className="truncate text-sm font-bold md:hidden">{title}</p>
            </div>
          </div>
          <div className="relative hidden lg:block">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              aria-label="Search rooms, bookings, guests"
              placeholder="Search rooms, bookings, guests…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                window.dispatchEvent(new CustomEvent("gilnet-search", { detail: e.target.value }));
              }}
              className="w-full rounded-lg border bg-background py-2.5 pl-10 pr-3 text-sm"
            />
            {search && (
              <div className="absolute inset-x-0 top-full z-50 border bg-card p-3 shadow-lg">
                <Link to="/dashboard" className="block py-2">
                  Rooms matching “{search}”
                </Link>
                <Link to="/reservations" search={{ add: false }} className="block py-2">
                  Bookings and guests
                </Link>
              </div>
            )}
          </div>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-xl text-white hover:bg-white/10 lg:hidden"
            aria-label="Search"
            aria-expanded={mobileSearchOpen}
            onClick={() => setMobileSearchOpen((open) => !open)}
          >
            <Search className="h-5 w-5" />
          </button>
          <Link
            to="/settings"
            className="flex shrink-0 items-center gap-2 rounded-full p-1.5 hover:bg-white/10 lg:gap-3 lg:hover:bg-transparent"
          >
            <Bell className="h-5 w-5 text-white lg:text-muted-foreground" />
            <span className="grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-white/15 text-sm font-bold text-white lg:border-0 lg:bg-primary lg:text-primary-foreground">
              {session.user_name.charAt(0)}
            </span>
            <span className="hidden text-sm font-medium xl:block">{session.user_name}</span>
          </Link>
          {mobileSearchOpen && (
            <div className="relative col-span-3 lg:hidden">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input
                aria-label="Search rooms, bookings, guests"
                placeholder="Search rooms, bookings, guests…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  window.dispatchEvent(
                    new CustomEvent("gilnet-search", { detail: e.target.value }),
                  );
                }}
                className="w-full rounded-lg border bg-background py-2.5 pl-10 pr-3 text-sm text-foreground"
              />
              {search && (
                <div className="absolute inset-x-0 top-full z-50 border bg-card p-3 text-foreground shadow-lg">
                  <Link to="/dashboard" className="block py-2">
                    Rooms matching “{search}”
                  </Link>
                  <Link to="/reservations" search={{ add: false }} className="block py-2">
                    Bookings and guests
                  </Link>
                </div>
              )}
            </div>
          )}
        </header>
        {!online && (
          <div
            role="status"
            className="border-b bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          >
            Offline - working from local
          </div>
        )}
        {subscriptionReminder && (
          <div
            role="status"
            className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
          >
            <p className="mx-auto max-w-5xl font-medium">{subscriptionReminder.message}</p>
          </div>
        )}
        {subscriptionReminderError && (
          <div
            role="alert"
            className="border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-center text-xs text-destructive"
          >
            Subscription expiry reminders could not be checked: {subscriptionReminderError}
          </div>
        )}
        {needsSignIn && <SyncStatusNotice onSignIn={() => void signInAgain()} />}
        <SyncConflictReview code={code} />
        <main className="flex-1 px-3 pb-28 pt-4 sm:px-4 md:px-8 md:pb-10 md:pt-6">
          {!hidePageHeading && (
            <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 md:mb-5">
              <div className="min-w-0">
                <h1 className="hidden text-2xl font-bold md:block">{title}</h1>
                <p className="hidden mt-1 text-xs text-muted-foreground md:block">
                  {new Date().toLocaleDateString(undefined, { dateStyle: "full" })}
                </p>
              </div>
              <span className="max-w-40 text-right text-[10px] text-muted-foreground md:text-xs">
                {displaySyncStatus}
              </span>
            </div>
          )}
          {!allow || can(session.role, allow) ? (
            children
          ) : (
            <NoAccess home={homeFor(session.role)} />
          )}
        </main>
        <div className="px-4 pb-24 md:hidden">
          <InstallAppButton className="w-full" />
        </div>
        <footer className="hidden border-t px-8 py-3 text-center text-[11px] text-muted-foreground md:block">
          {APP_NAME} · {SUPPORT_EMAIL} · Version {APP_VERSION}
        </footer>
      </div>

      <nav
        aria-label="Primary navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-sidebar-border bg-sidebar/95 px-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-sidebar-foreground backdrop-blur md:hidden"
      >
        <Link
          to={homeFor(session.role)}
          className={cn(
            "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-sidebar-foreground/75",
            (path === homeFor(session.role) || path === "/dashboard") &&
              "bg-sidebar-primary text-sidebar-primary-foreground",
          )}
        >
          <LayoutGrid className="h-5 w-5" />
          {session.role === "Restaurant"
            ? "POS"
            : session.role === "Housekeeping"
              ? "Rooms"
              : "Dashboard"}
        </Link>
        {BOTTOM.filter((n) => !n.allow || can(session.role, n.allow)).map((n) => {
          const active = path.startsWith(n.to);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-sidebar-foreground/75",
                active && "bg-sidebar-primary text-sidebar-primary-foreground",
              )}
            >
              <n.icon className="h-5 w-5" />
              {n.label}
              {n.to === "/messages" && unread > 0 && (
                <span className="absolute -top-0.5 right-1 rounded-full bg-destructive px-1 text-[9px] text-destructive-foreground">
                  {unread}
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          aria-label="More app functions"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
          className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5 text-[10px] font-medium text-sidebar-foreground/75"
        >
          <MoreHorizontal className="h-5 w-5" />
          More
          {updateAvail && (
            <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-brand-amber" />
          )}
        </button>
      </nav>
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          className="flex w-[88vw] max-w-sm flex-col border-sidebar-border bg-sidebar p-4 text-sidebar-foreground"
        >
          <SheetHeader className="pr-8">
            <PropertyHeader code={code} property={property} />
            <SheetTitle className="sr-only">All GILNET operations</SheetTitle>
            <SheetDescription className="sr-only">
              Choose an operation available for your account role.
            </SheetDescription>
          </SheetHeader>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/60">
            All operations
          </p>
          <nav className="flex-1 space-y-1 overflow-y-auto">
            {SIDEBAR.filter((item) => !item.allow || can(session.role, item.allow)).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent",
                  path.startsWith(item.to) && "bg-sidebar-primary text-sidebar-primary-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.to === "/messages" && unread > 0 && (
                  <span className="rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                    {unread}
                  </span>
                )}
                {item.to === "/settings" && updateAvail && (
                  <span className="h-2 w-2 rounded-full bg-brand-amber" />
                )}
              </Link>
            ))}
          </nav>
          <div className="border-t border-sidebar-border pt-3">
            <InstallAppButton className="w-full" />
            <p className="mt-3 text-center text-xs text-sidebar-foreground/60">
              Signed in as {session.user_name} · {session.role}
            </p>
            <p className="mt-1 text-center text-[10px] text-sidebar-foreground/50">
              Version {APP_VERSION}
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function NoAccess({ home }: { home: string }) {
  return (
    <div className="mx-auto max-w-md rounded-3xl border bg-card p-8 text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-3 font-bold">This area is not part of your role.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Ask a manager or supervisor if you need access.
      </p>
      <Link
        to={home}
        className="mt-4 inline-block rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
      >
        Go to my page
      </Link>
    </div>
  );
}

export function ViaFooter() {
  return <p className="mt-3 text-center text-[11px] text-muted-foreground">via {APP_NAME}</p>;
}

export const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
};
