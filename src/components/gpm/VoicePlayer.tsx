import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { fmtDur } from "@/lib/useVoiceRecorder";
import { cn } from "@/lib/utils";

const BARS = [4, 9, 6, 12, 8, 14, 7, 10, 5, 12, 9, 6, 11, 7, 4, 9, 13, 6, 8, 5];

export function VoicePlayer({ src, duration, mine }: { src: string; duration: number | null; mine?: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const a = new Audio(src);
    audio.current = a;
    a.ontimeupdate = () => setProgress(a.duration && isFinite(a.duration) ? a.currentTime / a.duration : a.currentTime / (duration || 1));
    a.onended = () => {
      setPlaying(false);
      setProgress(0);
    };
    return () => a.pause();
  }, [src, duration]);

  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (playing) a.pause();
    else a.play().catch(() => undefined);
    setPlaying(!playing);
  };
  const cycle = () => {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audio.current) audio.current.playbackRate = next;
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn("grid h-8 w-8 place-items-center rounded-full", mine ? "bg-primary-foreground/20" : "bg-primary text-primary-foreground")}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <div className="flex h-6 items-center gap-[2px]">
        {BARS.map((h, i) => (
          <span
            key={i}
            style={{ height: h + 4 }}
            className={cn("w-[3px] rounded-full", i / BARS.length < progress ? (mine ? "bg-primary-foreground" : "bg-primary") : mine ? "bg-primary-foreground/40" : "bg-muted-foreground/30")}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums opacity-80">{fmtDur(duration ?? 0)}</span>
      <button onClick={cycle} className="rounded-full px-1.5 text-[10px] font-semibold opacity-80 ring-1 ring-current">
        {rate}x
      </button>
    </div>
  );
}
