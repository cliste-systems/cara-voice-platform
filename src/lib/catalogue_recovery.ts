/** Two bounded, cancellable reads. Never use this for orders, messages or writes. */
export async function hedgedCatalogueRead<T>(
  read: (attempt: 0 | 1, signal: AbortSignal) => Promise<T>,
  recoverable: (error: unknown) => boolean,
  delayMs = 2000,
): Promise<T> {
  const controllers = [new AbortController(), new AbortController()];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let backupStarted = false;
  let settled = false;
  let failures = 0;
  try {
    return await new Promise<T>((resolve, reject) => {
      const start = (attempt: 0 | 1) => {
        void read(attempt, controllers[attempt]!.signal).then(result => {
          if (settled) return;
          settled = true;
          resolve(result);
        }).catch(error => {
          if (settled) return;
          failures++;
          if (!recoverable(error) || failures === 2) {
            settled = true;
            reject(error);
          } else {
            backup();
          }
        });
      };
      const backup = () => {
        if (settled || backupStarted) return;
        backupStarted = true;
        start(1);
      };
      timer = setTimeout(backup, delayMs);
      start(0);
    });
  } finally {
    if (timer) clearTimeout(timer);
    for (const controller of controllers) controller.abort();
  }
}
