import { Bell, Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/lib/auth";
import {
  getDefaultAppPreferences,
  type AppPreferences,
  updateAppPreferences,
} from "@/lib/app-preferences";
import { keys, useStored } from "@/lib/db";

export function AppPreferencesPanel() {
  const session = useSession();
  const propertyCode = session?.property_code ?? "";
  const staffId = session?.staff_id ?? session?.token ?? "";
  const savedPreferences = useStored<Partial<AppPreferences>>(
    keys.appPreferences(propertyCode, staffId),
    {},
  );
  const preferences = {
    ...getDefaultAppPreferences(session?.role),
    ...savedPreferences,
  };

  const setDesktopNotifications = async (enabled: boolean) => {
    if (enabled) {
      if (typeof Notification === "undefined") {
        toast.error("Desktop notifications are not supported on this device.");
        return;
      }
      if (Notification.permission === "denied") {
        toast.error(
          "Desktop notifications are blocked. Allow them in your browser settings first.",
        );
        return;
      }
      if (Notification.permission !== "granted") {
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            toast.error("Desktop notification permission was not granted.");
            return;
          }
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `Could not enable desktop notifications: ${error.message}`
              : "Could not enable desktop notifications.",
          );
          return;
        }
      }
    }

    updateAppPreferences(propertyCode, staffId, { desktopNotifications: enabled }, session?.role);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-brand-border bg-card p-4">
      <div>
        <h2 className="font-bold">Appearance and notifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          These preferences are saved for your staff login on this device.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border pb-4">
        <div>
          <p className="text-sm font-semibold">Appearance</p>
          <p className="mt-1 text-xs text-muted-foreground">Choose light or dark mode.</p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={preferences.theme === "light" ? "default" : "outline"}
            onClick={() =>
              updateAppPreferences(propertyCode, staffId, { theme: "light" }, session?.role)
            }
          >
            <Sun className="mr-1 h-4 w-4" />
            Light
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preferences.theme === "dark" ? "default" : "outline"}
            onClick={() =>
              updateAppPreferences(propertyCode, staffId, { theme: "dark" }, session?.role)
            }
          >
            <Moon className="mr-1 h-4 w-4" />
            Dark
          </Button>
        </div>
      </div>

      <label className="flex items-center justify-between gap-4 border-b border-brand-border pb-4">
        <span>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Bell className="h-4 w-4 text-primary" />
            Incoming message alerts
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Show an alert when a private message is sent to you.
          </span>
        </span>
        <Switch
          checked={preferences.messageNotifications}
          onCheckedChange={(enabled) =>
            updateAppPreferences(
              propertyCode,
              staffId,
              { messageNotifications: enabled },
              session?.role,
            )
          }
          aria-label="Incoming message alerts"
        />
      </label>

      <label className="flex items-center justify-between gap-4 border-b border-brand-border pb-4">
        <span>
          <span className="text-sm font-semibold">Check-in notices</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Receive guest and staff check-in notices. Enabled by default for Front Desk, Admin,
            Manager, and Supervisor.
          </span>
        </span>
        <Switch
          checked={preferences.checkInNotices}
          onCheckedChange={(enabled) =>
            updateAppPreferences(propertyCode, staffId, { checkInNotices: enabled }, session?.role)
          }
          aria-label="Check-in notices"
        />
      </label>

      <label className="flex items-center justify-between gap-4 border-b border-brand-border pb-4">
        <span>
          <span className="text-sm font-semibold">Desktop notifications</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            Allow browser notifications for app alerts. Permission is requested only when enabled.
          </span>
        </span>
        <Switch
          checked={preferences.desktopNotifications}
          onCheckedChange={(enabled) => void setDesktopNotifications(enabled)}
          aria-label="Desktop notifications"
        />
      </label>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Floating quick-access bubbles</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Show shortcuts for attendance, messages, and notices. These settings are saved for your
            staff login on this device.
          </p>
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Staff attendance bubble</span>
          <Switch
            checked={preferences.floatingAttendanceBubble}
            onCheckedChange={(enabled) =>
              updateAppPreferences(
                propertyCode,
                staffId,
                { floatingAttendanceBubble: enabled },
                session?.role,
              )
            }
            aria-label="Staff attendance bubble"
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Messages bubble</span>
          <Switch
            checked={preferences.floatingMessagesBubble}
            onCheckedChange={(enabled) =>
              updateAppPreferences(
                propertyCode,
                staffId,
                { floatingMessagesBubble: enabled },
                session?.role,
              )
            }
            aria-label="Messages bubble"
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Notices bubble</span>
          <Switch
            checked={preferences.floatingNoticesBubble}
            onCheckedChange={(enabled) =>
              updateAppPreferences(
                propertyCode,
                staffId,
                { floatingNoticesBubble: enabled },
                session?.role,
              )
            }
            aria-label="Notices bubble"
          />
        </label>
      </div>
    </section>
  );
}
