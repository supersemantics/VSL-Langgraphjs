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
  AutomationDeniedException,
  CompiledGate,
  Fallback,
  Invariant,
  InvariantViolation,
  PreNode,
  VSLAdapter,
} from "@supersemantics/vsl-core";

const DEFAULT_FALLBACK = new Fallback();

/**
 * Node's equivalent of Python's `warnings.warn()`: emits a capturable
 * `'warning'` event on `process` (filterable by `.name`, same role
 * `pytest.warns(UserWarning, match=...)` plays in the Python tests this
 * was ported from) rather than an unstructured console.warn print.
 */
export const VSL_GOVERNANCE_WARNING_NAME = "VSLGovernanceWarning";

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
