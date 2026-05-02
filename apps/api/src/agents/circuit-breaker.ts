export interface CircuitBreakerOptions {
  failureThreshold: number;
  windowMs: number;
  recoveryMs: number;
  onOpen: () => void;
  onRecovered: () => void;
}

export class CircuitBreaker {
  private failureTimestamps: number[] = [];
  private isOpen = false;
  private recoveryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  recordFailure(): void {
    if (this.isOpen) return;
    const now = Date.now();
    this.failureTimestamps.push(now);
    this.prune(now);
    if (this.failureTimestamps.length >= this.options.failureThreshold) {
      this.open();
    }
  }

  recordSuccess(): void {
    this.failureTimestamps = [];
    if (this.isOpen) {
      // Close the circuit but leave the recovery timer running.
      // onRecovered fires only via the scheduled timeout (passive 15-min probe),
      // not immediately on a secondary success.
      this.isOpen = false;
    }
  }

  isTripped(): boolean {
    return this.isOpen;
  }

  // Test/teardown helper — clears any pending recovery timer so unhandled
  // timers don't leak between unit tests or process shutdown.
  dispose(): void {
    if (this.recoveryTimeoutId !== null) {
      clearTimeout(this.recoveryTimeoutId);
      this.recoveryTimeoutId = null;
    }
  }

  private prune(now: number): void {
    const cutoff = now - this.options.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= cutoff);
  }

  private open(): void {
    this.isOpen = true;
    this.options.onOpen();
    this.recoveryTimeoutId = setTimeout(() => {
      this.recoveryTimeoutId = null;
      this.close();
      this.options.onRecovered();
    }, this.options.recoveryMs);
  }

  private close(): void {
    this.isOpen = false;
    this.failureTimestamps = [];
    if (this.recoveryTimeoutId !== null) {
      clearTimeout(this.recoveryTimeoutId);
      this.recoveryTimeoutId = null;
    }
  }
}
