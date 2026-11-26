import { describe, expect, it } from "vitest";
import {
  Fallback,
  GammaEstimate,
  Invariant,
  InvariantViolation,
  PreNode,
  TerminalState,
} from "@supersemantics/vsl-core";
import { LangGraphAdapter, VSL_GOVERNANCE_WARNING_NAME } from "../src/adapter.js";

async function plainMonitor(_candidateInput: unknown): Promise<GammaEstimate> {
  return new GammaEstimate({ gammaHat: 2.0 });
}

/**
 * process.emitWarning's 'warning' event fires asynchronously (next tick),
 * not synchronously with the emitWarning() call -- this waits one macro-
 * task so any emitted warning has actually reached the listener before
 * assertions run.
 */
async function collectWarnings(fn: () => void): Promise<Array<{ name: string; message: string }>> {
  const captured: Array<{ name: string; message: string }> = [];
  const handler = (warning: Error) => {
    captured.push({ name: warning.name, message: warning.message });
  };
  process.on("warning", handler);
  fn();
  await new Promise((resolve) => setImmediate(resolve));
  process.off("warning", handler);
  return captured;
}

function governanceWarnings(captured: Array<{ name: string; message: string }>): string[] {
  return captured.filter((w) => w.name === VSL_GOVERNANCE_WARNING_NAME).map((w) => w.message);
}

describe("gates without an assurance basis", () => {
  it("compile without any warning", async () => {
    const preNode = new PreNode({ name: "p", description: "d", monitor: plainMonitor });
    const invariant = new Invariant({ name: "i", description: "d", rule: async () => true });
    const captured = await collectWarnings(() => {
      new LangGraphAdapter().compilePreNode(preNode);
      new LangGraphAdapter().compileInvariant(invariant);
    });
    expect(captured).toEqual([]);
  });
});

describe("Fallback non-default warning", () => {
  it("warns when a PreNode sets a non-default Fallback", async () => {
    const preNode = new PreNode({
      name: "retry-pre-node",
      description: "x",
      monitor: plainMonitor,
      fallback: new Fallback({ maxRetries: 5 }),
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured).some((m) => m.includes("non-default Fallback"))).toBe(true);
  });

  it("does not warn for the default Fallback", async () => {
    const preNode = new PreNode({
      name: "default-fallback-pre-node",
      description: "x",
      monitor: plainMonitor,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured).some((m) => m.includes("non-default Fallback"))).toBe(false);
  });
});

describe("LangGraphAdapter gate behavior", () => {
  it("compilePreNode's gate throws AutomationDeniedException on insufficient Gamma", async () => {
    const preNode = new PreNode({
      name: "cap",
      description: "x",
      monitor: async () => new GammaEstimate({ gammaHat: 0.1 }),
      gammaThreshold: 1.1,
    });
    const gate = new LangGraphAdapter().compilePreNode(preNode);
    await expect(gate("candidate")).rejects.toThrow(/insufficient Gamma/);
  });

  it("compileInvariant's gate throws InvariantViolation, terminalStateName null when onViolation is unset", async () => {
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async () => false,
    });
    const gate = new LangGraphAdapter().compileInvariant(invariant);
    try {
      await gate("candidate");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(InvariantViolation);
      expect((exc as InvariantViolation).terminalStateName).toBeNull();
      expect((exc as InvariantViolation).reason).not.toContain("entering terminal state");
    }
  });

  it("compileInvariant's gate includes the terminal state name in reason when onViolation is set", async () => {
    const halted = new TerminalState({ name: "halted", description: "x" });
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async () => false,
      onViolation: halted,
    });
    const gate = new LangGraphAdapter().compileInvariant(invariant);
    try {
      await gate("candidate");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(InvariantViolation);
      expect((exc as InvariantViolation).terminalStateName).toBe("halted");
      expect((exc as InvariantViolation).reason).toContain('entering terminal state "halted"');
    }
  });
});
