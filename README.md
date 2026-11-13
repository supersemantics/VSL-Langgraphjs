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
import { AssuranceBasis, F2Modification, GammaEstimate, PreNode } from "@supersemantics/vsl-core";
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
  assuranceBasis: new AssuranceBasis(true, F2Modification.NONE),
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

## The F1/F2 assurance distinction -- same caveat as `vsl-core`

Every `PreNode`/`Invariant` here still requires an `AssuranceBasis`, and it's
still **self-declared, not independently verified**. See `vsl-core`'s README
("The F1/F2 assurance distinction") for the full explanation.

`LangGraphAdapter` carries one detectable-case check: `compilePreNode`/
`compileInvariant` emit a `process.emitWarning` (type `VSLGovernanceWarning`)
if a `monitor`/`rule` claims `F2Modification.FULL` but its own source text
mentions a hosted model API (`openai`/`anthropic`/`google.genai`/`cohere`/
`mistralai`) -- a black-box API call structurally cannot modify the energy
function directly, so `FULL` isn't achievable that way.

**This heuristic is narrower here than in the Python `vsl-langgraph` it was
ported from.** Python's version additionally walks one level of indirection
through `fn.__code__.co_names`/`fn.__globals__` to catch a monitor that calls
a separate helper function which itself reaches a hosted API -- the realistic,
common shape (a monitor calling a `judgeConfidence()` in another module).
JavaScript has no equivalent runtime introspection for "what does this
identifier resolve to from outside a closure" -- replicating that would
require an AST parser and scope resolution, a real dependency this package
doesn't take on. **The TS heuristic only catches a hosted-API call written
directly inside the monitor/rule's own function body** (via
`Function.prototype.toString()`); a monitor that delegates to a helper
function is not caught, even if that helper obviously reaches a hosted API.
Disclosed here and in `adapter.ts`'s own comments, not silently narrowed --
see `tests/adapter.test.ts`'s "disclosed gap" test for a concrete example.

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
`ledger.writeMonitor`/`ledger.write(LedgerEntryType.PRE_NODE, ...)`/
`writeVerification` explicitly, causally linked via `causedBy` -- the same
three entry types the Python `vsl-core` package's own [building
guide](https://github.com/supersemantics/VSL-Core/blob/main/docs/building-with-vsl-core.md#step-3-the-five-things-youll-actually-write)
says to write around every gated call (`vsl-corejs` has no separate guide
of its own; the construct names and ledger contract are identical here).
Skip `PRE_NODE` and `VerbaLedger.audit()`'s
`drift_flagged_monitor_has_pre_node` check fails on any denial -- not a bug
in `audit()`, just an incomplete write. Where those writes are kept is up to you: `VerbaLedger`
accepts any `LedgerStore`, and vsl-corejs includes `InMemoryLedgerStore` and `JsonlLedgerStore`.

## Install

```bash
npm install @supersemantics/vsl-langgraph
```

This installs `@supersemantics/vsl-core` and `@langchain/langgraph` with it. If your own code also
imports `@supersemantics/vsl-core`, depend on a compatible version (`^0.2.3`), so npm installs one
copy: `gatedNode` recognises a denial with `instanceof`.

## Layout

```
src/
├── adapter.ts       LangGraphAdapter (VSLAdapter conformance contract)
└── integration.ts   gatedNode, routeOnDenial
tests/
├── adapter.test.ts       conformance, hosted-API warning (direct + disclosed-gap cases), Fallback warning
├── conformance.test.ts   runConformanceSuite(LangGraphAdapter()) == []
├── integration.test.ts   gatedNode/routeOnDenial, real allow/deny/error-propagation paths
└── fixtures/             hosted-API-shaped monitor/rule fixtures
```

## Status

Alpha. 22 tests pass, 100% statement/branch/function/line coverage on
`src/`. Verified against the real `@langchain/langgraph` package (not
mocks): a real `StateGraph` compiled and run end-to-end, confirming a
gated node is skipped entirely on denial and the graph routes correctly.
Both ESM and CommonJS builds verified with real `import()`/`require()`
against the built `dist/` output.

## License

MIT -- see LICENSE. Copyright Super Semantics.
