# @supersemantics/vsl-langgraph

A [LangGraph.js](https://www.npmjs.com/package/@langchain/langgraph) adapter
for [`@supersemantics/vsl-core`](https://github.com/supersemantics/VSL-Corejs)
(the TypeScript port of [`vsl-core`](https://github.com/supersemantics/VSL-Core)):
implements `VSLAdapter` and provides `gatedNode`/`routeOnDenial` -- a direct
TypeScript port of [`vsl-langgraph`](https://github.com/supersemantics/VSL-Langgraph).

**Is:**
- A `VSLAdapter` implementation (`LangGraphAdapter`) that passes `runConformanceSuite` with no failures.
- `gatedNode`/`routeOnDenial`: wiring helpers for calling a compiled gate immediately before a LangGraph.js node runs, and routing around a denial with `addConditionalEdges`.

**Is not:**
- A replacement for `@supersemantics/vsl-core` -- `PreNode`/`Invariant`/`Fallback`/`TerminalState`, the ledger, and the governance vocabulary all live there. This package only compiles and wires those constructs into LangGraph.js.

## Quick taste

```typescript
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { GammaEstimate, PreNode } from "@supersemantics/vsl-core";
import { LangGraphAdapter, gatedNode, routeOnDenial, DEFAULT_DENIAL_KEY } from "@supersemantics/vsl-langgraph";

const State = Annotation.Root({
  amount: Annotation<number>(),
  [DEFAULT_DENIAL_KEY]: Annotation({ default: () => undefined }),
  result: Annotation({ default: () => undefined }),
});

const preNode = new PreNode({
  name: "cap-check",
  description: "amount must be under 1000",
  monitor: async (input) => new GammaEstimate({ gammaHat: (input as { amount: number }).amount <= 1000 ? 2.0 : 0.0 }),
});
const gate = new LangGraphAdapter().compilePreNode(preNode);

const graph = new StateGraph(State)
  .addNode("approve", gatedNode(gate, async (state) => ({ result: `approved ${state.amount}` })))
  .addNode("blocked", async () => ({ result: "blocked" }))
  .addEdge(START, "approve")
  .addConditionalEdges("approve", routeOnDenial("blocked", END))
  .addEdge("blocked", END)
  .compile();
```

## What a gate reports

Gates take no assurance claim: build a `PreNode` or `Invariant` from its name, description and
monitor or rule. Whether a gate ran before its node is computed from the ledger, not declared (see
[vsl-core's "What a gate reports"](https://github.com/supersemantics/VSL-Core#what-a-gate-reports)).
Code written for 0.1.x that still passes `assuranceBasis` gets one `DeprecationWarning` from
`@supersemantics/vsl-core`; delete the argument.

## `gatedNode` doesn't consume `Fallback`

A `PreNode`'s `Fallback` (`onFailure`, `deltaFactor`, `maxRetries`,
`onMaxRetries`) is policy data only here -- `gatedNode` doesn't read it. On
denial, the wrapped node raises once, immediately; there is no retry loop.
`compilePreNode` warns if a `PreNode`'s `Fallback` is non-default, so this
can't be silently assumed.

## `gatedNode` doesn't write to the ledger either

Nothing in `gatedNode` calls `VerbaLedger.write*` -- a gate denial becomes a
state update (`state[denialKey]`), and that's it. If you want an audit
trail, your own node has to call
`ledger.writeGateDecision`/`ledger.write(LedgerEntryType.PRE_NODE, ...)`/
`writeVerification` explicitly, causally linked via `causedBy` -- the same
three entry types the Python `vsl-core` package's own [building
guide](https://github.com/supersemantics/VSL-Core/blob/main/docs/building-with-vsl-core.md#step-3-the-five-things-youll-actually-write)
says to write around every gated call (`vsl-corejs` has no separate guide
of its own; the construct names and ledger contract are identical here).
Skip `PRE_NODE` and `VerbaLedger.audit()`'s
`drift_flagged_monitor_has_pre_node` check fails on any denial -- not a bug
in `audit()`, just an incomplete write. Where those writes are kept is up to you: `VerbaLedger`
accepts any `LedgerStore`, and vsl-corejs includes `InMemoryLedgerStore` and `JsonlLedgerStore`.

To record the node's side effect itself, call
`await ledger.writeAction(identityKey, actionName, { decisionId })` inside the wrapped node, with the
same `decisionId` as the gate's `writeGateDecision`. `await ledger.enforcement(decisionId)` then reads
`BEFORE_ACTION` when every gate decision came before the node ran (or a denial skipped it), and
`AFTER_ACTION` when the node ran first.

## Install

```bash
npm install @supersemantics/vsl-langgraph
```

This installs `@supersemantics/vsl-core` and `@langchain/langgraph` with it. If your own code also
imports `@supersemantics/vsl-core`, depend on a compatible version (`^0.3.0`), so npm installs one
copy: `gatedNode` recognises a denial with `instanceof`.

## Layout

```
src/
├── adapter.ts       LangGraphAdapter (VSLAdapter conformance contract)
└── integration.ts   gatedNode, routeOnDenial
tests/
├── adapter.test.ts       gate behavior, no warning without a basis, Fallback warning
├── conformance.test.ts   runConformanceSuite(LangGraphAdapter()) == []
└── integration.test.ts   gatedNode/routeOnDenial, real allow/deny/error-propagation paths, enforcement through a real StateGraph
```

## Status

Alpha. 19 tests pass, 100% statement/branch/function/line coverage on
`src/`. Verified against the real `@langchain/langgraph` package (not
mocks): a real `StateGraph` compiled and run end-to-end, confirming a
gated node is skipped entirely on denial and the graph routes correctly.
Both ESM and CommonJS builds verified with real `import()`/`require()`
against the built `dist/` output.

## License

MIT -- see LICENSE. Copyright Super Semantics.
