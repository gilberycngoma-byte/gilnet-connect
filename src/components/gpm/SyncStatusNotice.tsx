import { useEffect, useState } from "react";

type SyncStatusNoticeProps = {
  onSignIn: () => void;
};

export function SyncStatusNotice({ onSignIn }: SyncStatusNoticeProps) {
  const [showDetails, setShowDetails] = useState(true);

  useEffect(() => {
    setShowDetails(true);
    const timeout = window.setTimeout(() => setShowDetails(false), 5000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!showDetails) {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center justify-center gap-2 border-b border-amber-300 bg-amber-50/70 px-4 py-1.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100"
      >
        <span>Sync paused</span>
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-md border border-current px-2 py-0.5 font-medium"
        >
          Sign in again
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <span>
        Cloud sync is paused until you sign in again. Pending changes and conflict copies remain on
        this device.
      </span>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded-md border border-current px-3 py-1 font-medium"
      >
        Sign in again
      </button>
    </div>
  );
}
