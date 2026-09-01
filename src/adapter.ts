/**
 * LangGraphAdapter: a VSLAdapter conformant with vsl-core's conformance
 * contract, intended for use inside LangGraph.js nodes.
 *
 * LangGraph.js has no dedicated guardrail/interception type -- a
 * StateGraph node is just a plain sync/async function, and conditional
 * edges are plain router functions evaluated after a node returns.
 * There is therefore nothing LangGraph-specific to compile a
 * PreNode/Invariant *into*: the compiled gate is the same
 * framework-agnostic async callable vsl-core's own conformance suite
 * expects, called directly inside a node body before the side effect it
 * guards. What this package adds on top (see integration.ts) is the
 * wiring convention for calling that gate from a node and routing around
 * a denial with addConditionalEdges, not a different gate-compilation
 * strategy. Port of vsl_langgraph/adapter.py.
 */

import {
  AssuranceBasis,
  AutomationDeniedException,
  CompiledGate,
  F2Modification,
  Fallback,
  Invariant,
  InvariantViolation,
  PreNode,
  VSLAdapter,
} from "@supersemantics/vsl-core";

const DEFAULT_FALLBACK = new Fallback();

/**
 * Source-text markers for hosted, black-box model APIs. A gate whose
 * monitor/rule reaches one of these cannot honestly claim
 * F2Modification.FULL -- FULL requires direct access to the energy
 * function itself (logits, weights, activations), which a hosted API
 * call structurally cannot expose. The honest ceiling for a hosted-API-
 * backed check is PARTIAL (MEDIUM), per vsl-core's own README example.
 *
 * This is a heuristic, not a proof, and it is narrower here than in the
 * Python vsl-langgraph this was ported from: it scans only the
 * monitor/rule function's OWN source text (via Function.prototype.toString()),
 * not any helper function it calls. Python's version additionally walks
 * one level of indirection through `fn.__code__.co_names` +
 * `fn.__globals__` -- JavaScript has no equivalent runtime introspection
 * for "what does this identifier resolve to from outside a closure";
 * replicating that would require an AST parser and scope resolution, a
 * real new dependency and meaningfully more complexity than the rest of
 * this adapter. This means the common real-world pattern of a monitor
 * calling a separate provider-helper function (e.g. a `judgeConfidence()`
 * in another module that itself calls the Anthropic SDK) is NOT caught
 * here -- only a hosted-API call written directly inside the monitor/
 * rule's own body is. Disclosed, not silently narrowed.
 */
const HOSTED_API_MARKERS = ["openai", "anthropic", "google.genai", "google.generativeai", "cohere", "mistralai"];

/**
 * True if `fn`'s own source text (not any function it calls) mentions a
 * hosted-API marker. Case-insensitive: real code capitalizes SDK class
 * names (AsyncAnthropic, AsyncOpenAI).
 */
function reachesHostedApi(fn: (...args: unknown[]) => unknown): boolean {
  const source = fn.toString().toLowerCase();
  return HOSTED_API_MARKERS.some((marker) => source.includes(marker));
}

/**
 * Node's equivalent of Python's `warnings.warn()`: emits a capturable
 * `'warning'` event on `process` (filterable by `.name`, same role
 * `pytest.warns(UserWarning, match=...)` plays in the Python tests this
 * was ported from) rather than an unstructured console.warn print.
 */
export const VSL_GOVERNANCE_WARNING_NAME = "VSLGovernanceWarning";

function warnIfFullClaimReachesHostedApi(
  name: string,
  assuranceBasis: AssuranceBasis,
  fn: (...args: unknown[]) => unknown
): void {
  if (assuranceBasis.f2Modification !== F2Modification.FULL) return;
  if (!reachesHostedApi(fn)) return;
  process.emitWarning(
    `${name} claims F2Modification.FULL, but its monitor/rule's own source appears to call a hosted ` +
      `model API (openai/anthropic/google.genai/cohere/mistralai detected). A hosted, black-box API ` +
      `call cannot directly modify the energy function -- FULL is not achievable this way. The honest ` +
      `ceiling is F2Modification.PARTIAL (MEDIUM assurance), per vsl-core's own README F1/F2 example. ` +
      `This is a heuristic check scoped to this function's own source only (not helper functions it ` +
      `calls) -- it can miss indirect calls, and passing it does not confirm FULL is correct either.`,
    { type: VSL_GOVERNANCE_WARNING_NAME }
  );
}

export class LangGraphAdapter implements VSLAdapter {
  compilePreNode(preNode: PreNode): CompiledGate {
    if (!preNode.fallback.equals(DEFAULT_FALLBACK)) {
      process.emitWarning(
        `PreNode "${preNode.name}" sets a non-default Fallback, but gatedNode does not consume Fallback -- ` +
          `a denial raises once, immediately, with no retry loop. Implement retry behavior yourself around ` +
          `the compiled gate if needed.`,
        { type: VSL_GOVERNANCE_WARNING_NAME }
      );
    }
    warnIfFullClaimReachesHostedApi(`PreNode "${preNode.name}"`, preNode.assuranceBasis, preNode.monitor as never);

    return async (candidateInput: unknown): Promise<void> => {
      const estimate = await preNode.monitor(candidateInput);
      if (!estimate.sufficient(preNode.gammaThreshold)) {
        throw new AutomationDeniedException({
          reason: `Pre-node "${preNode.name}" insufficient Gamma`,
          identityKey: "vsl-langgraph",
        });
      }
    };
  }

  compileInvariant(invariant: Invariant): CompiledGate {
    warnIfFullClaimReachesHostedApi(`Invariant "${invariant.name}"`, invariant.assuranceBasis, invariant.rule as never);

    return async (candidateInput: unknown): Promise<void> => {
      const holds = await invariant.rule(candidateInput);
      if (!holds) {
        let reason = `Invariant "${invariant.name}" violated`;
        const terminalStateName = invariant.onViolation !== null ? invariant.onViolation.name : null;
        if (terminalStateName !== null) {
          reason += ` -- entering terminal state "${terminalStateName}"`;
        }
        throw new InvariantViolation({
          reason,
          identityKey: "vsl-langgraph",
          invariantName: invariant.name,
          terminalStateName,
        });
      }
    };
  }
}
