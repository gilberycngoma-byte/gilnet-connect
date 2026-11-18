export type InstallMode = 'installed' | 'ios' | 'browser';
export function installMode(input: { standalone: boolean; electron: boolean; userAgent: string; platform: string; touchPoints: number }): InstallMode {
  if (input.standalone || input.electron) return 'installed';
  if (/iPad|iPhone|iPod/i.test(input.userAgent) || (input.platform === 'MacIntel' && input.touchPoints > 1)) return 'ios';
  return 'browser';
}
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}