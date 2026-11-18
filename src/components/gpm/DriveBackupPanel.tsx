import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createDriveBackup, restoreDriveBackup } from "@/lib/driveBackup";
import { getElectronBridge, type DriveStatus, type GilnetElectron } from "@/lib/electron";
import { keys, read, write } from "@/lib/db";
import { synchronize } from "@/lib/supabaseSync";
import { toast } from "sonner";

const CLIENT_ID_PATTERN = /^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;
const INITIAL_DRIVE_STATUS: DriveStatus = { connected: false, email: "" };

export function DriveBackupPanel({ propertyCode }: { propertyCode: string }) {
  const [bridge, setBridge] = useState<GilnetElectron>();
  const [clientId, setClientId] = useState(() =>
    read(keys.driveClientId, import.meta.env["VITE_GOOGLE_OAUTH_CLIENT_ID"] ?? ""),
  );
  const [status, setStatus] = useState(INITIAL_DRIVE_STATUS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const electron = getElectronBridge();
    if (!electron) return;
    setBridge(electron);
    void electron.driveStatus()
      .then(setStatus)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Could not read Google Drive connection status."));
  }, []);

  if (!bridge) return null;

  const connect = async () => {
    if (!CLIENT_ID_PATTERN.test(clientId.trim())) {
      setError("Enter a valid Google OAuth Desktop app Client ID.");
      return;
    }
    write(keys.driveClientId, clientId.trim(), false);
    setBusy(true);
    setError("");
    try {
      const connected = await bridge.connectDrive(clientId.trim());
      setStatus(connected);
      toast.success(`Google Drive connected${connected.email ? ` as ${connected.email}` : ""}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not connect Google Drive.");
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    setBusy(true);
    setError("");
    try {
      const snapshot = await createDriveBackup(propertyCode);
      await bridge.backupDrive(clientId.trim(), snapshot);
      toast.success("Private Google Drive backup completed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not back up property data.");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!window.confirm("Merge the saved Google Drive backup into this device? Existing local records and pending edits are preserved.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const snapshot = await bridge.restoreDrive(clientId.trim(), propertyCode.trim().toUpperCase());
      if (!snapshot) {
        setError("No Google Drive backup exists for this property yet.");
        return;
      }
      const result = restoreDriveBackup(snapshot, propertyCode);
      if (navigator.onLine) void synchronize();
      toast.success(`Restored ${result.recordCount} local data groups. Supabase will reconcile when online.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore the Google Drive backup.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      setStatus(await bridge.disconnectDrive());
      toast.success("Google Drive was disconnected from this device.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Google Drive.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-brand-border bg-brand-soft p-4">
      <div>
        <p className="font-bold">Google Drive backup · Electron</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Private app-data backup for this Google account. It can contain guest details, bookings, messages and sales; login sessions and credentials are excluded. Supabase remains the team sync and access-control service.
        </p>
      </div>
      <Input
        aria-label="Google OAuth Desktop app Client ID"
        autoComplete="off"
        placeholder="Google OAuth Desktop app Client ID"
        value={clientId}
        disabled={busy}
        onChange={(event) => setClientId(event.target.value)}
        onBlur={() => write(keys.driveClientId, clientId.trim(), false)}
      />
      {status.connected ? (
        <>
          <p className="text-sm">Connected{status.email ? ` · ${status.email}` : ""}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy || !propertyCode} onClick={backup}>
              {busy ? "Working…" : "Back up now"}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !propertyCode} onClick={restore}>
              Restore backup
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" disabled={busy} onClick={connect}>
          {busy ? "Connecting…" : "Connect Google Drive"}
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
