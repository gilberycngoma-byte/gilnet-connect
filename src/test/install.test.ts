import { describe, expect, it } from 'vitest';
import { installMode } from '@/lib/install';
const browser = { standalone: false, electron: false, userAgent: 'Chrome', platform: 'Win32', touchPoints: 0 };
describe('App install availability', () => {
  it('does not offer installation inside an already installed PWA', () => expect(installMode({ ...browser, standalone: true })).toBe('installed'));
  it('does not offer PWA installation inside Electron', () => expect(installMode({ ...browser, electron: true })).toBe('installed'));
  it('provides the iPhone home-screen installation path', () => expect(installMode({ ...browser, userAgent: 'iPhone Safari' })).toBe('ios'));
  it('recognizes an iPad using desktop identification', () => expect(installMode({ ...browser, platform: 'MacIntel', touchPoints: 5 })).toBe('ios'));
  it('offers browser installation on a Windows browser', () => expect(installMode(browser)).toBe('browser'));
});