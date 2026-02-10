import { log } from "./cli.ts";

export class Timer {
  private initialTimestamp: number;
  private lastCheckpointTimestamp: number | null = null;

  constructor() {
    this.initialTimestamp = Date.now();
  }

  checkpoint(name: string): void {
    const now = Date.now();
    const duration = this.lastCheckpointTimestamp
      ? now - this.lastCheckpointTimestamp
      : now - this.initialTimestamp;

    log.debug(`» ${name}: ${duration}ms`);
    this.lastCheckpointTimestamp = now;
  }
}

const THINKING_THRESHOLD = 3000; // ms

export class ThinkingTimer {
  private readonly durationFormatter = new Intl.NumberFormat("en-US", {
    style: "unit",
    unit: "second",
    unitDisplay: "long",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });

  private lastToolResultTimestamp: number | null = null;

  markToolResult(): void {
    this.lastToolResultTimestamp = Date.now();
    log.debug(`» thinking timer: markToolResult at ${this.lastToolResultTimestamp}`);
  }

  markToolCall(): void {
    const now = Date.now();
    log.debug(`» thinking timer: markToolCall at ${now}, lastToolResult=${this.lastToolResultTimestamp}`);
    if (this.lastToolResultTimestamp === null) return;
    const elapsed = now - this.lastToolResultTimestamp;
    if (elapsed < THINKING_THRESHOLD) return;
    const seconds = elapsed / 1000;
    log.info(`» thought for ${this.durationFormatter.format(seconds)}`);
  }
}
