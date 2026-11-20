import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addAttendanceNetwork,
  currentAttendanceNetworkIp,
  deleteAttendanceNetwork,
  listAttendanceNetworks,
} from "@/lib/attendance.functions";

export function AttendanceNetworkSettings() {
  const [label, setLabel] = useState("Office Wi-Fi");
  const [busy, setBusy] = useState(false);
  const networks = useQuery({
    queryKey: ["attendance-networks"],
    queryFn: listAttendanceNetworks,
  });
  const currentIp = useQuery({
    queryKey: ["attendance-network-ip"],
    queryFn: currentAttendanceNetworkIp,
  });

  const refresh = async () => {
    await Promise.all([networks.refetch(), currentIp.refetch()]);
  };

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      await addAttendanceNetwork({ data: { label: label.trim() } });
      await refresh();
      toast.success("This office Wi-Fi is now allowed for attendance.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not add this office Wi-Fi.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, networkLabel: string) => {
    if (!window.confirm(`Stop allowing ${networkLabel} for attendance?`)) return;
    try {
      await deleteAttendanceNetwork({ data: { id } });
      await networks.refetch();
      toast.success("Office Wi-Fi removed.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Could not remove this office Wi-Fi.");
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-brand-border bg-card p-4">
      <div>
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          <h2 className="font-bold">Company Wi-Fi for attendance</h2>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Add a network from the property office. Staff can check in and out only while connected to
          an allowed office network.
        </p>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Connect this device to the office Wi-Fi and turn off mobile data.</li>
        <li>Confirm the detected address below, name the network, then add it.</li>
      </ol>
      <p className="text-xs text-muted-foreground">Detected network address</p>
      <p className="font-mono text-sm font-semibold">
        {currentIp.isPending ? "Checking…" : (currentIp.data ?? "Could not detect network address")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Office Wi-Fi name"
          value={label}
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          className="min-w-48 flex-1"
        />
        <Button
          type="button"
          disabled={busy || currentIp.isPending || !currentIp.data || !label.trim()}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Allow this Wi-Fi"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={currentIp.isFetching}
          onClick={() => void currentIp.refetch()}
        >
          Refresh address
        </Button>
      </div>
      {(currentIp.error || networks.error) && (
        <p role="alert" className="text-sm text-destructive">
          {currentIp.error instanceof Error
            ? currentIp.error.message
            : networks.error instanceof Error
              ? networks.error.message
              : ""}
        </p>
      )}
      <div>
        <h3 className="mb-2 text-sm font-semibold">Allowed office networks</h3>
        {networks.isPending ? (
          <p className="text-sm text-muted-foreground">Loading allowed networks…</p>
        ) : networks.data?.length ? (
          <ul className="divide-y rounded-xl border border-brand-border">
            {networks.data.map((network) => (
              <li key={network.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{network.label}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {network.ip_address}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${network.label}`}
                  onClick={() => void remove(network.id, network.label)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-destructive/40 p-3 text-sm text-muted-foreground">
            No office network is allowed yet. Attendance check-in and check-out stay blocked until
            the Admin adds one.
          </p>
        )}
      </div>
    </section>
  );
}
