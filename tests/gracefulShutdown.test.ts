import { describe, it, expect, vi, afterEach } from "vitest";
import { setupSignalHandlers } from "../src/core/utils/gracefulShutdown.js";

describe("setupSignalHandlers", () => {
  const registeredListeners: Array<{ signal: string; listener: (...args: any[]) => void }> = [];
  const originalOn = process.on;

  afterEach(() => {
    process.on = originalOn;
    registeredListeners.length = 0;
    vi.restoreAllMocks();
  });

  it("registers SIGTERM and SIGINT event listeners on process", () => {
    vi.spyOn(process, "on").mockImplementation((signal, listener) => {
      registeredListeners.push({ signal, listener: listener as (...args: any[]) => void });
      return process;
    });

    const onShutdown = vi.fn().mockResolvedValue(undefined);
    setupSignalHandlers({ timeoutMs: 5000, onShutdown });

    const signals = registeredListeners.map((l) => l.signal);
    expect(signals).toContain("SIGTERM");
    expect(signals).toContain("SIGINT");
  });

  it("invokes onShutdown when a signal listener is triggered", async () => {
    vi.spyOn(process, "on").mockImplementation((signal, listener) => {
      registeredListeners.push({ signal, listener: listener as (...args: any[]) => void });
      return process;
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

    const onShutdown = vi.fn().mockResolvedValue(undefined);
    setupSignalHandlers({ timeoutMs: 5000, onShutdown });

    const sigtermEntry = registeredListeners.find((l) => l.signal === "SIGTERM");
    expect(sigtermEntry).toBeDefined();

    await sigtermEntry!.listener();

    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
