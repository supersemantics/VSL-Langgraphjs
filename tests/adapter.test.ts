import { describe, expect, it } from "vitest";
import {
  AssuranceBasis,
  F2Modification,
  Fallback,
  GammaEstimate,
  Invariant,
  InvariantViolation,
  PreNode,
  TerminalState,
} from "@supersemantics/vsl-core";
import { LangGraphAdapter, VSL_GOVERNANCE_WARNING_NAME } from "../src/adapter.js";
import { directHostedMonitor, directHostedRule, indirectHostedMonitor } from "./fixtures/hostedApiMonitor.js";

const FULL_BASIS = new AssuranceBasis(true, F2Modification.FULL);
const PARTIAL_BASIS = new AssuranceBasis(true, F2Modification.PARTIAL);
const NONE_BASIS = new AssuranceBasis(true, F2Modification.NONE);

async function plainMonitor(_candidateInput: unknown): Promise<GammaEstimate> {
  // No hosted-API marker anywhere in this function's own source.
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

describe("hosted-API FULL-claim warning", () => {
  it("warns when a FULL claim's monitor directly mentions a hosted API in its own source", async () => {
    const preNode = new PreNode({
      name: "hosted-pre-node",
      description: "Claims FULL; monitor's own body mentions a hosted API.",
      monitor: directHostedMonitor,
      assuranceBasis: FULL_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    const warnings = governanceWarnings(captured);
    expect(warnings.some((m) => m.includes("claims F2Modification.FULL"))).toBe(true);
  });

  it("warns on Invariant too", async () => {
    const invariant = new Invariant({
      name: "hosted-invariant",
      description: "Claims FULL; rule's own body mentions a hosted API.",
      rule: directHostedRule,
      assuranceBasis: FULL_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compileInvariant(invariant));
    expect(governanceWarnings(captured).some((m) => m.includes("claims F2Modification.FULL"))).toBe(true);
  });

  it("does not warn when nothing hosted-API-shaped is in the monitor's own source", async () => {
    const preNode = new PreNode({
      name: "local-pre-node",
      description: "Claims FULL; nothing hosted-API-shaped.",
      monitor: plainMonitor,
      assuranceBasis: FULL_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured)).toEqual([]);
  });

  it("does not trigger on a PARTIAL claim, even reaching a hosted API directly", async () => {
    const preNode = new PreNode({
      name: "hosted-pre-node-partial",
      description: "Honestly rated PARTIAL for a hosted-API-backed check.",
      monitor: directHostedMonitor,
      assuranceBasis: PARTIAL_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured)).toEqual([]);
  });

  it("does not trigger on a NONE claim", async () => {
    const preNode = new PreNode({
      name: "hosted-pre-node-none",
      description: "NONE claim next to a hosted-API-shaped monitor.",
      monitor: directHostedMonitor,
      assuranceBasis: NONE_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured)).toEqual([]);
  });

  it("disclosed gap: does NOT warn when the hosted API is only reached via a helper function", async () => {
    // This is the realistic, common shape (a monitor calling a separate
    // provider-helper) -- Python's heuristic catches it via an
    // indirection walk with no JS equivalent (see adapter.ts). This is
    // documenting the gap, not asserting a bug.
    const preNode = new PreNode({
      name: "indirect-hosted-pre-node",
      description: "Claims FULL; reaches a hosted API only through a helper it calls.",
      monitor: indirectHostedMonitor,
      assuranceBasis: FULL_BASIS,
    });
    const captured = await collectWarnings(() => new LangGraphAdapter().compilePreNode(preNode));
    expect(governanceWarnings(captured)).toEqual([]);
  });
});

describe("Fallback non-default warning", () => {
  it("warns when a PreNode sets a non-default Fallback", async () => {
    const preNode = new PreNode({
      name: "retry-pre-node",
      description: "x",
      monitor: plainMonitor,
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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
