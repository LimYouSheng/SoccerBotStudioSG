type Priority = "foreground" | "display";
type Job = () => Promise<void>;

// Instance-owned scheduling only. Durable admission, attempt fences and unknown
// effects remain authoritative if the object restarts. Never preempt active I/O.
export class ProviderQueue {
  private foreground: Job[] = [];
  private display: Job[] = [];
  private running = false;
  private foregroundRun = 0;

  run<T>(priority: Priority, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this[priority].push(async () => {
        try {
          resolve(await operation());
        } catch (error) {
          reject(error);
        }
      });
      void this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.foreground.length || this.display.length) {
        // At most four consecutive foreground operations while display work
        // waits. FIFO within each class; a failed operation is never retried.
        const foreground =
          this.foreground.length > 0 &&
          (this.display.length === 0 || this.foregroundRun < 4);
        const job = (foreground ? this.foreground : this.display).shift()!;
        this.foregroundRun = foreground ? this.foregroundRun + 1 : 0;
        await job();
      }
    } finally {
      this.foregroundRun = 0;
      this.running = false;
    }
  }
}
