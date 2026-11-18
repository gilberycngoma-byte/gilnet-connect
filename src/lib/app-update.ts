/** Called only after the user confirms an update. Never clears device data or caches. */
export async function applyWebUpdate() {
  if (!navigator.onLine) throw new Error('Connect to the internet before updating. Your saved data is unchanged.');
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (registration) {
      await registration.update();
      const worker = registration.waiting ?? registration.installing;
      if (worker && worker.state !== 'activated') {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => finish(new Error('The update is not ready yet. Please try again.')), 30000);
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            worker.removeEventListener('statechange', changed);
            if (error) reject(error); else resolve();
          };
          const changed = () => {
            if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
            if (worker.state === 'activated') finish();
            if (worker.state === 'redundant') finish(new Error('The update could not be installed. Please try again.'));
          };
          worker.addEventListener('statechange', changed);
          changed();
        });
      }
    }
  }
  window.location.assign(window.location.href);
}