import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyWebUpdate } from '@/lib/app-update';
import { read, write } from '@/lib/db';
import { fetchLatestVersion } from '@/lib/version';

const { maybeSingle } = vi.hoisted(() => ({ maybeSingle: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  },
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
beforeEach(() => { maybeSingle.mockReset(); });
describe('Manual release updates', () => {
  it('treats unavailable browser storage as an empty store', () => {
    vi.stubGlobal('window', undefined);
    expect(write('gilnet_cloud250_session', { user: 'tester' })).toBeUndefined();
    expect(read('gilnet_cloud250_session', null)).toBeNull();
    vi.unstubAllGlobals();
  });
  it('preserves operational storage when an offline update is refused', async () => {
    localStorage.setItem('gilnet_cloud250_rooms_RELEASE', JSON.stringify([{ number: '1', status: 'Occupied' }]));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(applyWebUpdate()).rejects.toThrow('Connect to the internet');
    expect(JSON.parse(localStorage.getItem('gilnet_cloud250_rooms_RELEASE') ?? '[]')).toEqual([{ number: '1', status: 'Occupied' }]);
  });
  it('does not delete caches when worker activation fails', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const remove = vi.fn();
    const update = vi.fn().mockRejectedValue(new Error('Download unavailable'));
    vi.stubGlobal('caches', { delete: remove, keys: vi.fn().mockResolvedValue(['gilnet-pages', 'other-app-cache']) });
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ update }) } });
    await expect(applyWebUpdate()).rejects.toThrow('Download unavailable');
    expect(remove).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it('loads published installer links and release notes from Supabase', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        version: '2.5.5',
        release_notes: 'New release',
        forced: false,
        apk_url: 'https://storage.example/app.apk',
        public_url: 'https://storage.example/app.exe',
        file_name: 'app.exe',
      },
      error: null,
    });
    await expect(fetchLatestVersion()).resolves.toEqual({
      latestStable: '2.5.5',
      releaseNotes: 'New release',
      forced: false,
      apkUrl: 'https://storage.example/app.apk',
      publicUrl: 'https://storage.example/app.exe',
      fileName: 'app.exe',
    });
  });
  it('rejects a malformed release row instead of treating it as current', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    maybeSingle.mockResolvedValue({
      data: { version: 'invalid', release_notes: 'Bad version', forced: false },
      error: null,
    });
    expect(await fetchLatestVersion()).toBeNull();
  });
  it('returns no release result when the online check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    expect(await fetchLatestVersion()).toBeNull();
  });
  it('asks the waiting worker to activate only during the confirmed update action', async () => {
    const worker = new EventTarget() as EventTarget & { state: string; postMessage: ReturnType<typeof vi.fn> };
    worker.state = 'installed';
    worker.postMessage = vi.fn(() => {
      worker.state = 'redundant';
      worker.dispatchEvent(new Event('statechange'));
    });
    const update = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ update, waiting: worker }) } });
    expect(worker.postMessage).not.toHaveBeenCalled();
    await expect(applyWebUpdate()).rejects.toThrow('could not be installed');
    expect(update).toHaveBeenCalledTimes(1);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});