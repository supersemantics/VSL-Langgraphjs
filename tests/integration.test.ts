import { describe, expect, it } from "vitest";
import {
  AssuranceBasis,
  F2Modification,
  GammaEstimate,
  Invariant,
  PreNode,
} from "@supersemantics/vsl-core";
import { LangGraphAdapter } from "../src/adapter.js";
import { DEFAULT_DENIAL_KEY, gatedNode, routeOnDenial } from "../src/integration.js";

const adapter = new LangGraphAdapter();

describe("gatedNode with a PreNode gate", () => {
  it("sufficient Gamma: runs the node and does not set the denial key", async () => {
    const preNode = new PreNode({
      name: "confidence",
      description: "x",
      monitor: async (input) => new GammaEstimate({ gammaHat: (input as { confidence: number }).confidence }),
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
      gammaThreshold: 1.1,
    });
    const gate = adapter.compilePreNode(preNode);

    let nodeRan = false;
    const wrapped = gatedNode(gate, async (state: { confidence: number }) => {
      nodeRan = true;
      return { result: "approved" };
    });

    const update = await wrapped({ confidence: 5.0 });
    expect(nodeRan).toBe(true);
    expect(update["result"]).toBe("approved");
    expect(update[DEFAULT_DENIAL_KEY]).toBeUndefined();
  });

  it("insufficient Gamma: skips the node entirely and sets the denial key", async () => {
    const preNode = new PreNode({
      name: "confidence",
      description: "x",
      monitor: async (input) => new GammaEstimate({ gammaHat: (input as { confidence: number }).confidence }),
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
      gammaThreshold: 1.1,
    });
    const gate = adapter.compilePreNode(preNode);

    let nodeRan = false;
    const wrapped = gatedNode(gate, async (_state: { confidence: number }) => {
      nodeRan = true;
      return { result: "approved" };
    });

    const update = await wrapped({ confidence: 0.1 });
    expect(nodeRan).toBe(false); // real proof of F1 pre-commitment
    expect(update[DEFAULT_DENIAL_KEY]).toBeDefined();
  });
});

describe("gatedNode with an Invariant gate", () => {
  it("passing rule: runs the node", async () => {
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async (input) => (input as { amount: number }).amount <= 1000,
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
    });
    const gate = adapter.compileInvariant(invariant);

    let nodeRan = false;
    const wrapped = gatedNode(gate, async (_state: { amount: number }) => {
      nodeRan = true;
      return {};
    });

    await wrapped({ amount: 250 });
    expect(nodeRan).toBe(true);
  });

  it("violated rule: skips the node and sets the denial key", async () => {
    const invariant = new Invariant({
      name: "hard-cap",
      description: "x",
      rule: async (input) => (input as { amount: number }).amount <= 1000,
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
    });
    const gate = adapter.compileInvariant(invariant);

    let nodeRan = false;
    const wrapped = gatedNode(gate, async (_state: { amount: number }) => {
      nodeRan = true;
      return {};
    });

    const update = await wrapped({ amount: 5000 });
    expect(nodeRan).toBe(false);
    expect(update[DEFAULT_DENIAL_KEY]).toBeDefined();
  });
});

describe("routeOnDenial", () => {
  it("routes to blockedNode when the denial key is set", () => {
    const router = routeOnDenial("blocked", "allowed");
    expect(router({ [DEFAULT_DENIAL_KEY]: new Error("denied") })).toBe("blocked");
  });

  it("routes to allowedNode when the denial key is absent", () => {
    const router = routeOnDenial("blocked", "allowed");
    expect(router({})).toBe("allowed");
  });

  it("respects a custom denialKey", () => {
    const router = routeOnDenial("blocked", "allowed", { denialKey: "customDenial" });
    expect(router({ customDenial: "x" })).toBe("blocked");
    expect(router({ [DEFAULT_DENIAL_KEY]: "x" })).toBe("allowed"); // wrong key, must not match
  });
});

describe("gatedNode candidateInputFn", () => {
  it("extracts a subset of state for the gate, not the whole state object", async () => {
    let receivedByGate: unknown = null;
    const preNode = new PreNode({
      name: "x",
      description: "x",
      monitor: async (input) => {
        receivedByGate = input;
        return new GammaEstimate({ gammaHat: 2.0 });
      },
      assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
    });
    const gate = adapter.compilePreNode(preNode);

    const wrapped = gatedNode(gate, async () => ({}), {
      candidateInputFn: (state: { amount: number; irrelevant: string }) => state.amount,
    });

    await wrapped({ amount: 42, irrelevant: "noise" });
    expect(receivedByGate).toBe(42);
  });
});

describe("gatedNode when the wrapped node returns nothing", () => {
  it("returns an empty state update rather than throwing", async () => {
    const gate = async (): Promise<void> => {};
    // @ts-expect-error deliberately returning undefined to exercise the falsy branch
    const wrapped = gatedNode(gate, async () => undefined);

    await expect(wrapped({})).resolves.toEqual({});
  });
});

describe("gatedNode propagates unexpected errors rather than swallowing them as denials", () => {
  it("rethrows a non-AutomationDeniedException error from the gate", async () => {
    const gate = async (): Promise<void> => {
      throw new TypeError("something genuinely broke in the gate, unrelated to governance");
    };
    const wrapped = gatedNode(gate, async () => ({}));

    await expect(wrapped({})).rejects.toThrow(TypeError);
  });
});
