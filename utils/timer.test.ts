import * as cli from "./cli.ts";
import { ThinkingTimer, Timer } from "./timer.ts";

describe("Timer", () => {
  beforeEach(() => {
    vi.spyOn(cli.log, "debug");
    // Mock Date.now to have predictable timestamps
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("should initialize with current timestamp", () => {
      const mockTime = 1000000;
      vi.setSystemTime(mockTime);

      const timer = new Timer();
      timer.checkpoint("test");

      expect(cli.log.debug).toHaveBeenCalledWith(expect.stringContaining("test"));
    });
  });

  describe("checkpoint", () => {
    it("should log duration from initial timestamp on first checkpoint", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      const checkpointTime = startTime + 100;
      vi.setSystemTime(checkpointTime);
      timer.checkpoint("first");

      expect(cli.log.debug).toHaveBeenCalledWith("» first: 100ms");
    });

    it("should log duration from last checkpoint on subsequent checkpoints", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // First checkpoint
      const firstCheckpointTime = startTime + 50;
      vi.setSystemTime(firstCheckpointTime);
      timer.checkpoint("first");

      // Second checkpoint
      const secondCheckpointTime = firstCheckpointTime + 75;
      vi.setSystemTime(secondCheckpointTime);
      timer.checkpoint("second");

      expect(cli.log.debug).toHaveBeenCalledTimes(2);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, "» first: 50ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, "» second: 75ms");
    });

    it("should handle multiple checkpoints correctly", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // First checkpoint
      vi.setSystemTime(startTime + 10);
      timer.checkpoint("step1");

      // Second checkpoint
      vi.setSystemTime(startTime + 25);
      timer.checkpoint("step2");

      // Third checkpoint
      vi.setSystemTime(startTime + 45);
      timer.checkpoint("step3");

      expect(cli.log.debug).toHaveBeenCalledTimes(3);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, "» step1: 10ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, "» step2: 15ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(3, "» step3: 20ms");
    });

    it("should handle zero duration correctly", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      // Checkpoint immediately
      timer.checkpoint("immediate");

      expect(cli.log.debug).toHaveBeenCalledWith("» immediate: 0ms");
    });

    it("should handle custom checkpoint names", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);
      const timer = new Timer();

      vi.setSystemTime(startTime + 200);
      timer.checkpoint("Custom Checkpoint Name");

      expect(cli.log.debug).toHaveBeenCalledWith("» Custom Checkpoint Name: 200ms");
    });
  });
});

describe("ThinkingTimer", () => {
  beforeEach(() => {
    vi.spyOn(cli.log, "info");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("markToolResult", () => {
    it("should store the current timestamp", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 5000);
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalled();
    });
  });

  describe("markToolCall", () => {
    it("should not log if markToolResult was never called", () => {
      const timer = new ThinkingTimer();
      timer.markToolCall();

      expect(cli.log.info).not.toHaveBeenCalled();
    });

    it("should not log if elapsed time is below threshold (3000ms)", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 2999);
      timer.markToolCall();

      expect(cli.log.info).not.toHaveBeenCalled();
    });

    it("should log if elapsed time equals threshold (3000ms)", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 3000);
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 3 seconds");
    });

    it("should log if elapsed time exceeds threshold", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 5500);
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 5.5 seconds");
    });

    it("should format large durations correctly", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 15000);
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 15 seconds");
    });

    it("should handle multiple markToolCall invocations", () => {
      const startTime = 1000000;
      vi.setSystemTime(startTime);

      const timer = new ThinkingTimer();
      timer.markToolResult();

      vi.setSystemTime(startTime + 4000);
      timer.markToolCall();

      vi.setSystemTime(startTime + 5000);
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledTimes(2);
      expect(cli.log.info).toHaveBeenNthCalledWith(1, "» thought for 4 seconds");
      expect(cli.log.info).toHaveBeenNthCalledWith(2, "» thought for 5 seconds");
    });
  });
});
