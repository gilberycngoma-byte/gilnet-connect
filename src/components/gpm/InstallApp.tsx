import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { installMode, type InstallMode, type InstallPromptEvent } from '@/lib/install';
import { APP_NAME } from '@/lib/version';

const InstallContext = createContext<{ mode: InstallMode; prompt: InstallPromptEvent | null; clear: () => void }>({ mode: 'browser', prompt: null, clear: () => {} });

export function InstallAppProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<InstallMode>('browser');
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const update = () => setMode(installMode({
      standalone: display.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      electron: 'gilnetElectron' in window || /Electron/i.test(navigator.userAgent),
      userAgent: navigator.userAgent, platform: navigator.platform, touchPoints: navigator.maxTouchPoints,
    }));
    const capture = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPromptEvent); };
    const installed = () => { setMode('installed'); setPrompt(null); };
    update();
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    display.addEventListener('change', update);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
      display.removeEventListener('change', update);
    };
  }, []);
  return <InstallContext.Provider value={{ mode, prompt, clear: () => setPrompt(null) }}>{children}</InstallContext.Provider>;
}

export function InstallAppButton({ className }: { className?: string }) {
  const { mode, prompt, clear } = useContext(InstallContext);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (mode === 'installed') return null;
  const install = async () => {
    if (!prompt) { setOpen(true); return; }
    setBusy(true); setError('');
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { setError('Installation could not start. Try your browser’s install menu.'); setOpen(true); }
    finally { clear(); setBusy(false); }
  };
  return <>
    <Button type="button" variant="outline" className={className} disabled={busy} onClick={install}>
      {busy ? <LoaderCircle className="animate-spin" /> : <Download />} {busy ? 'Installing…' : 'Install App'}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>Install {APP_NAME}</DialogTitle>
          <DialogDescription>{mode === 'ios' ? 'In Safari, tap Share, then Add to Home Screen, and confirm Add.' : 'In Chrome or Edge, open the browser menu and choose Install App or Add to Home Screen. If it is missing, installation is not available in this browser yet.'}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>
      </DialogContent>
    </Dialog>
  </>;
}