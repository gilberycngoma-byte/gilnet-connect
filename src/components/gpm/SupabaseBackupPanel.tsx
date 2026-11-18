import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  backupToSupabase,
  findLatestSupabaseBackup,
  restoreFromSupabase,
  type SupabaseBackupFile,
} from "@/lib/driveBackup";
import { getElectronBridge, type PropertyFolderInfo } from "@/lib/electron";
import { keys, read, useStored, write } from "@/lib/db";
import { resumeSync, synchronize } from "@/lib/supabaseSync";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type BackupSchedule = "hourly" | "daily" | "weekly" | "monthly" | "after_each_entry";
type BackupRun = Tables<"property_backup_runs">;
const backupSchedules: { value: BackupSchedule; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "after_each_entry", label: "Never — back up after every new entry" },
];

type BackupStatus = {
  lastBackupAt?: string | undefined;
  lastBackupPath?: string | undefined;
  localFolderPath?: string | undefined;
  restoredAt?: string | undefined;
  error?: string | undefined;
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "The property backup operation failed.";
}

function saveStatus(code: string, patch: BackupStatus) {
  write(
    keys.cloudBackupStatus(code),
    { ...read<BackupStatus>(keys.cloudBackupStatus(code), {}), ...patch },
    false,
  );
}

export function CloudBackupRestorePrompt({ propertyCode }: { propertyCode: string }) {
  const [backup, setBackup] = useState<SupabaseBackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void findLatestSupabaseBackup(propertyCode)
      .then((latest) => {
        if (!active || !latest) return;
        if (read<string>(keys.cloudBackupSeen(propertyCode), "") !== latest.path) setBackup(latest);
      })
      .catch((cause) => {
        if (!active) return;
        const message = messageOf(cause);
        saveStatus(propertyCode, { error: message });
        setError(message);
      });
    return () => {
      active = false;
    };
  }, [propertyCode]);

  const dismiss = () => {
    if (backup) write(keys.cloudBackupSeen(propertyCode), backup.path, false);
    setBackup(null);
    setError("");
  };

  const restore = async () => {
    if (!backup) return;
    setBusy(true);
    setError("");
    try {
      const restored = await restoreFromSupabase(propertyCode, backup.path);
      write(keys.cloudBackupSeen(propertyCode), backup.path, false);
      saveStatus(propertyCode, { restoredAt: restored.createdAt, error: undefined });
      resumeSync();
      await synchronize();
      toast.success(`Restored ${restored.recordCount} local data groups.`);
      setBackup(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!backup} onOpenChange={(open) => !open && !busy && dismiss()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Property backup found</DialogTitle>
        </DialogHeader>
        {backup && (
          <p className="text-sm text-muted-foreground">
            A backup from {new Date(backup.createdAt).toLocaleString()} is available. Restore it to
            merge its records with this device?
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={restore}>
            {busy ? "Restoring…" : "Restore backup"}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={dismiss}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SupabaseBackupPanel({ propertyCode }: { propertyCode: string }) {
  const status = useStored<BackupStatus>(keys.cloudBackupStatus(propertyCode), {});
  const folder = useStored<PropertyFolderInfo | null>(keys.propertyFolder(propertyCode), null);
  const [schedule, setSchedule] = useState<BackupSchedule | "">("");
  const [scheduleDraft, setScheduleDraft] = useState<BackupSchedule | "">("");
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [latestRun, setLatestRun] = useState<BackupRun | null>(null);
  const [latest, setLatest] = useState<SupabaseBackupFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bridge = getElectronBridge();
  const canSetSchedule = getCurrentUser()?.role === "Admin";

  const refreshPolicy = useCallback(async () => {
    const [settingsResult, runsResult] = await Promise.all([
      supabase
        .from("property_backup_settings")
        .select("schedule")
        .eq("property_code", propertyCode)
        .maybeSingle(),
      supabase
        .from("property_backup_runs")
        .select("*")
        .eq("property_code", propertyCode)
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (settingsResult.error || runsResult.error) {
      throw new Error(
        `Could not load property backup settings: ${settingsResult.error?.message ?? runsResult.error?.message}`,
      );
    }
    const selected =
      settingsResult.data?.schedule &&
      backupSchedules.some((option) => option.value === settingsResult.data?.schedule)
        ? (settingsResult.data.schedule as BackupSchedule)
        : "";
    setSchedule(selected);
    setScheduleDraft((current) => current || selected);
    setLatestRun(runsResult.data?.[0] ?? null);
  }, [propertyCode]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void refreshPolicy().catch((cause: unknown) => {
        if (active) {
          setScheduleError(
            `${messageOf(cause)} Apply supabase/migrations/20261118050000_property_backup_scheduler.sql to enable server-managed schedules.`,
          );
        }
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    void findLatestSupabaseBackup(propertyCode)
      .then((file) => {
        if (!active) return;
        setLatest(file);
        if (file && !status.lastBackupAt)
          saveStatus(propertyCode, { lastBackupAt: file.createdAt });
      })
      .catch((cause) => {
        if (!active) return;
        const message = messageOf(cause);
        setError(message);
        saveStatus(propertyCode, { error: message });
      });
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [propertyCode, refreshPolicy, status.lastBackupAt]);

  const saveSchedule = async () => {
    if (!canSetSchedule || !scheduleDraft) return;
    setScheduleBusy(true);
    setScheduleError("");
    try {
      const { error: saveError } = await supabase.rpc("gpm_set_property_backup_schedule", {
        p_schedule: scheduleDraft,
      });
      if (saveError) throw saveError;
      setSchedule(scheduleDraft);
      await refreshPolicy();
      toast.success("Property backup plan saved.");
    } catch (cause) {
      const message = messageOf(cause);
      setScheduleError(message);
      toast.error(message);
    } finally {
      setScheduleBusy(false);
    }
  };

  const backupNow = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await backupToSupabase(propertyCode);
      const { error: reportError } = await supabase.rpc("gpm_record_property_backup_run", {
        p_status: "success",
        p_backup_path: result.path,
        p_record_count: result.recordCount,
      });
      setLatest({ path: result.path, createdAt: result.createdAt });
      write(keys.cloudBackupSeen(propertyCode), result.path, false);
      if (result.localFolder) {
        write(keys.propertyFolder(propertyCode), result.localFolder, false);
      }
      saveStatus(propertyCode, {
        lastBackupAt: result.createdAt,
        lastBackupPath: result.path,
        localFolderPath: result.localFolder?.path,
        error: reportError
          ? `Cloud backup completed, but its run status could not be saved: ${reportError.message}`
          : result.localError,
      });
      if (reportError) {
        setError(
          `Cloud backup completed, but its run status could not be saved: ${reportError.message}`,
        );
        toast.warning("Cloud backup completed; its status could not be recorded.");
      } else if (result.localError)
        toast.warning(`Cloud backup completed; local folder backup failed: ${result.localError}`);
      else toast.success("Property backup completed.");
    } catch (cause) {
      let message = messageOf(cause);
      try {
        const { error: reportError } = await supabase.rpc("gpm_record_property_backup_run", {
          p_status: "failure",
          p_error_message: message.slice(0, 800),
        });
        if (reportError) {
          message += ` Backup failure status could not be recorded: ${reportError.message}`;
        }
      } catch (reportCause) {
        message += ` Backup failure status could not be recorded: ${messageOf(reportCause)}`;
      }
      setError(message);
      saveStatus(propertyCode, { error: message });
    } finally {
      setBusy(false);
    }
  };

  const restoreLatest = async () => {
    if (
      !latest ||
      !window.confirm(
        "Merge the latest cloud backup with local data? Existing local edits are preserved.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const restored = await restoreFromSupabase(propertyCode, latest.path);
      write(keys.cloudBackupSeen(propertyCode), latest.path, false);
      saveStatus(propertyCode, { restoredAt: restored.createdAt, error: undefined });
      resumeSync();
      await synchronize();
      toast.success(`Restored ${restored.recordCount} local data groups.`);
    } catch (cause) {
      const message = messageOf(cause);
      setError(message);
      saveStatus(propertyCode, { error: message });
    } finally {
      setBusy(false);
    }
  };

  const openFolder = async () => {
    if (!bridge) return;
    try {
      await bridge.openPropertyFolder(propertyCode);
    } catch (cause) {
      const message = messageOf(cause);
      setError(message);
      toast.error(message);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-brand-border bg-brand-soft p-4">
      <div>
        <p className="font-bold">Property backup · Supabase cloud</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Cloud snapshots run server-side, even while the app is closed. Offline unsynced changes
          remain on the device until they sync.
        </p>
      </div>
      <div className="space-y-2 rounded-xl border bg-card p-3">
        <label
          className="block space-y-1.5 text-sm font-semibold"
          htmlFor="property-backup-schedule"
        >
          Automatic backup plan
          <select
            id="property-backup-schedule"
            className="w-full rounded-lg border border-input bg-background px-3 py-2 font-normal"
            value={scheduleDraft}
            disabled={!canSetSchedule || scheduleBusy}
            onChange={(event) => setScheduleDraft(event.target.value as BackupSchedule | "")}
          >
            <option value="">Choose a plan</option>
            {backupSchedules.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          The “Never” option follows your requested setup: a new saved entry queues a backup, which
          runs within about a minute. Only the property Admin can change this plan.
        </p>
        {canSetSchedule && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!scheduleDraft || scheduleBusy || scheduleDraft === schedule}
            onClick={() => void saveSchedule()}
          >
            {scheduleBusy ? "Saving…" : "Save backup plan"}
          </Button>
        )}
        {scheduleError && (
          <p role="alert" className="text-xs text-destructive">
            {scheduleError}
          </p>
        )}
        {latestRun?.status === "failure" && (
          <p role="alert" className="text-sm text-destructive">
            The latest automatic backup failed
            {latestRun.created_at ? ` on ${new Date(latestRun.created_at).toLocaleString()}` : ""}.
            {latestRun.error_message ? ` ${latestRun.error_message}` : ""}
          </p>
        )}
        {latestRun?.status === "success" && (
          <p className="text-xs text-muted-foreground">
            Latest recorded backup: {new Date(latestRun.created_at).toLocaleString()}
          </p>
        )}
      </div>
      <p className="text-sm">
        Last backup:{" "}
        {status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : "Not backed up yet"}
      </p>
      {latest && <p className="break-all text-xs text-muted-foreground">{latest.path}</p>}
      {bridge && (
        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="text-sm font-semibold">Local property folder</p>
          <p className="break-all text-xs text-muted-foreground">
            {folder?.path ?? status.localFolderPath ?? "Creating folder in Documents…"}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={openFolder}>
            Open folder
          </Button>
        </div>
      )}
      {status.error && <p className="text-xs text-destructive">{status.error}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !propertyCode} onClick={backupNow}>
          {busy ? "Working…" : "Back up now"}
        </Button>
        <Button type="button" variant="outline" disabled={busy || !latest} onClick={restoreLatest}>
          Restore latest backup
        </Button>
      </div>
    </section>
  );
}
