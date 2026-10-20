import { ApiError } from "./policy";

type Priority = "recovery" | "foreground" | "display";
type Job = { run: () => Promise<void>; timer: ReturnType<typeof setTimeout> };

// Instance-owned scheduling only. Durable admission, attempt fences and unknown
// effects remain authoritative if the object restarts. Never preempt active I/O.
export class ProviderQueue {
  private recovery: Job[] = [];
  private foreground: Job[] = [];
  private display: Job[] = [];
  private running = false;
  private foregroundRun = 0;
  private recoveryRun = 0;

  constructor(
    private readonly limits = {
      capacity: 24,
      recoveryReserve: 4,
      waitMs: 15000,
    },
  ) {}

  run<T>(priority: Priority, operation: () => Promise<T>): Promise<T> {
    const waiting =
      this.recovery.length + this.foreground.length + this.display.length;
    const capacity =
      this.limits.capacity -
      (priority === "recovery" ? 0 : this.limits.recoveryReserve);
    if (waiting >= capacity) {
      this.measure(priority, 0, "full");
      return Promise.reject(new ApiError(503, "provider_queue_busy"));
    }
    const entered = performance.now();
    return new Promise<T>((resolve, reject) => {
      const job: Job = {
        timer: setTimeout(() => {
          const index = this[priority].indexOf(job);
          if (index < 0) return;
          this[priority].splice(index, 1);
          this.measure(priority, performance.now() - entered, "expired");
          reject(new ApiError(503, "provider_queue_busy"));
        }, this.limits.waitMs),
        run: async () => {
          clearTimeout(job.timer);
          if (performance.now() - entered >= this.limits.waitMs) {
            this.measure(priority, performance.now() - entered, "expired");
            reject(new ApiError(503, "provider_queue_busy"));
            return;
          }
          this.measure(priority, performance.now() - entered, "started");
          try {
            resolve(await operation());
          } catch (error) {
            reject(error);
          }
        },
      };
      this[priority].push(job);
      void this.drain();
    });
  }

  private measure(priority: Priority, waitMs: number, outcome: string) {
    console.log(
      JSON.stringify({
        event: "provider_queue",
        priority,
        waitMs: Math.round(waitMs),
        outcome,
      }),
    );
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (
        this.recovery.length ||
        this.foreground.length ||
        this.display.length
      ) {
        // Recovery gets the next turn, with at most two consecutive recoveries
        // while customer work waits. Display gets every fifth customer turn.
        const recovery =
          this.recovery.length > 0 &&
          (this.recoveryRun < 2 ||
            (!this.foreground.length && !this.display.length));
        const foreground =
          this.foreground.length > 0 &&
          (!this.display.length || this.foregroundRun < 4);
        const priority = recovery
          ? "recovery"
          : foreground
            ? "foreground"
            : "display";
        const job = this[priority].shift()!;
        this.recoveryRun = recovery ? this.recoveryRun + 1 : 0;
        if (!recovery)
          this.foregroundRun = foreground ? this.foregroundRun + 1 : 0;
        await job.run();
      }
    } finally {
      this.foregroundRun = 0;
      this.recoveryRun = 0;
      this.running = false;
    }
  }
}
