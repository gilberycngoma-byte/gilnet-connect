import { useEffect, useRef } from "react";
import { Mic, Trash2 } from "lucide-react";
import { fmtDur, useVoiceRecorder, type VoiceClip } from "@/lib/useVoiceRecorder";
import { VoicePlayer } from "./VoicePlayer";

/** Hold-to-record voice control used in forms. Calls onChange with the clip (or null). */
export function VoiceButton({ value, onChange, label = "Hold to record voice" }: { value: VoiceClip | null; onChange: (c: VoiceClip | null) => void; label?: string }) {
  const v = useVoiceRecorder();
  const sentRef = useRef<VoiceClip | null>(null);
  useEffect(() => {
    if (v.clip && v.clip !== sentRef.current) {
      sentRef.current = v.clip;
      onChange(v.clip);
    }
  }, [v.clip, onChange]);
  if (value)
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-brand-soft p-2">
        <VoicePlayer src={value.audio} duration={value.duration} />
        {value.transcript && <span className="truncate text-xs italic text-muted-foreground">“{value.transcript}”</span>}
        <button type="button" className="ml-auto text-destructive" aria-label="Delete voice" onClick={() => { onChange(null); v.setClip(null); }}>
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    );
  return (
    <div>
      <button
        type="button"
        onPointerDown={(e) => { e.preventDefault(); v.start(); }}
        onPointerUp={() => v.stop()}
        onPointerLeave={() => v.recording && v.stop()}
        className="flex w-full select-none items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-sm text-muted-foreground"
      >
        {v.recording ? (
          <><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" /> Recording {fmtDur(v.seconds)} · release to save</>
        ) : (
          <><Mic className="h-4 w-4" /> {label}</>
        )}
      </button>
      {v.error && <p className="mt-1 text-xs text-destructive">{v.error}</p>}
    </div>
  );
}
