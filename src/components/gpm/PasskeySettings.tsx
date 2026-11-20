import { useEffect, useState } from "react";
import { Fingerprint, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  canUsePasskeys,
  listPasskeys,
  registerPasskey,
  removePasskey,
  type PasskeyCredential,
} from "@/lib/passkeys";

export function PasskeySettings() {
  const [credentials, setCredentials] = useState<PasskeyCredential[]>([]);
  const [deviceName, setDeviceName] = useState("This device");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const supported = canUsePasskeys();

  useEffect(() => {
    if (!canUsePasskeys()) {
      setLoading(false);
      return;
    }
    let active = true;
    void listPasskeys()
      .then((items) => {
        if (active) setCredentials(items);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Could not load saved passkeys.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const addPasskey = async () => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await registerPasskey(deviceName);
      setMessage("Passkey added. You can now use it from the sign-in screen.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this passkey.");
      setBusy(false);
      return;
    }
    try {
      setCredentials(await listPasskeys());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The passkey was added but could not be listed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const deletePasskey = async (credential: PasskeyCredential) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await removePasskey(credential.id);
      setCredentials((items) => items.filter((item) => item.id !== credential.id));
      setMessage(`${credential.device_name} was removed.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this passkey.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Passkey sign-in"
      className="space-y-3 rounded-2xl border border-brand-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Fingerprint className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Fingerprint & passkeys</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Add a passkey with Windows Hello, a fingerprint reader, or a supported password manager.
        Your device will ask you to verify before saving it.
      </p>
      {supported ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Passkey name"
              maxLength={64}
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="Name this passkey"
            />
            <Button
              type="button"
              disabled={busy || !deviceName.trim()}
              onClick={() => void addPasskey()}
            >
              {busy ? "Please wait…" : "Add passkey"}
            </Button>
          </div>
          {loading ? (
            <p role="status" className="text-xs text-muted-foreground">
              Loading saved passkeys…
            </p>
          ) : credentials.length > 0 ? (
            <ul className="space-y-2">
              {credentials.map((credential) => (
                <li key={credential.id} className="flex items-center gap-2 rounded-xl border p-3">
                  <Fingerprint className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {credential.device_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Added {new Date(credential.created_at).toLocaleDateString()}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${credential.device_name}`}
                    disabled={busy}
                    onClick={() => void deletePasskey(credential)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : !error ? (
            <p className="text-xs text-muted-foreground">
              No passkeys have been added to this account.
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Passkeys require a secure connection and a supported browser or Windows app.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-primary">
          {message}
        </p>
      )}
    </section>
  );
}
