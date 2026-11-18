import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceClip = { audio: string; duration: number; transcript: string };

type SR = {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
};

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<VoiceClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);
  const speech = useRef<SR | null>(null);
  const transcript = useRef("");

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setClip(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      cancelled.current = false;
      transcript.current = "";
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const dur = Math.round((Date.now() - started.current) / 1000);
        if (cancelled.current || Date.now() - started.current < 1000) return;
        const blob = new Blob(chunks.current, { type: mime || "audio/webm" });
        const fr = new FileReader();
        fr.onload = () => setClip({ audio: String(fr.result), duration: Math.max(1, dur), transcript: transcript.current.trim() });
        fr.readAsDataURL(blob);
      };
      rec.current = mr;
      started.current = Date.now();
      mr.start(250);
      setRecording(true);
      setSeconds(0);
      timer.current = window.setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 250);

      const Ctor = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR })
        .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
      if (Ctor) {
        const sr = new Ctor();
        sr.continuous = true;
        sr.interimResults = false;
        sr.lang = "en-US";
        sr.onresult = (e) => {
          transcript.current = Array.from(e.results).map((r) => r[0]?.transcript ?? "").join(" ");
        };
        try {
          sr.start();
          speech.current = sr;
        } catch {
          /* ignore */
        }
      }
    } catch {
      setError("Microphone not available. Please allow microphone access.");
    }
  }, []);

  const stop = useCallback((cancel = false) => {
    cancelled.current = cancel;
    if (timer.current) clearInterval(timer.current);
    try {
      speech.current?.stop();
    } catch {
      /* ignore */
    }
    // give speech recognition a moment to deliver the final result
    setTimeout(() => {
      if (rec.current && rec.current.state !== "inactive") rec.current.stop();
    }, 300);
    setRecording(false);
  }, []);

  return { recording, seconds, clip, setClip, error, start, stop };
}

export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
