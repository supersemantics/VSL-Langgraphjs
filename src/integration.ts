/**
 * Wiring helpers for calling a compiled VSL gate from inside a LangGraph.js
 * node and routing around a denial with addConditionalEdges.
 *
 * vsl-core does not intercept anything on its own: a compiled gate only
 * ever throws or resolves, on demand, when called. gatedNode is that call
 * site, made reusable for a LangGraph StateGraph -- it calls the gate
 * immediately before the wrapped node would run (preserving F1
 * pre-commitment: the gate completes strictly before the guarded node's
 * side effect), and on denial returns a state update instead of letting
 * the exception propagate, so a conditional edge can route to a
 * blocked/terminal node in the normal LangGraph way rather than crashing
 * the graph run. Port of vsl_langgraph/integration.py.
 */

import { AutomationDeniedException, CompiledGate } from "@supersemantics/vsl-core";

export type StateNode<S, R> = (state: S) => R | Promise<R>;

export const DEFAULT_DENIAL_KEY = "vslDenial";

/**
 * Wrap `node` so `gate` is checked immediately before it runs.
 *
 * `candidateInputFn` extracts whatever the gate should evaluate from
 * graph state; defaults to passing the whole state through unchanged.
 *
 * On denial, `node` is never called and the returned state update sets
 * `denialKey` to the caught exception -- pair with `routeOnDenial` (or
 * your own router reading `denialKey`) in `addConditionalEdges` to send
 * the run to a blocked/terminal node.
 *
 * Does not consume `PreNode.fallback` -- a denial raises once,
 * immediately, with no retry loop, regardless of `fallback.maxRetries`.
 * `LangGraphAdapter.compilePreNode` warns if a non-default `Fallback` is
 * set.
 */
export function gatedNode<S extends object, R extends Record<string, unknown>>(
  gate: CompiledGate,
  node: StateNode<S, R>,
  options: {
    candidateInputFn?: (state: S) => unknown;
    denialKey?: string;
  } = {}
): (state: S) => Promise<Record<string, unknown>> {
  const extract = options.candidateInputFn ?? ((state: S) => state);
  const denialKey = options.denialKey ?? DEFAULT_DENIAL_KEY;

  return async (state: S): Promise<Record<string, unknown>> => {
    try {
      await gate(extract(state));
    } catch (exc) {
      if (exc instanceof AutomationDeniedException) {
        return { [denialKey]: exc };
      }
      throw exc;
    }

    const result = await node(state);
    return result ? { ...result } : {};
  };
}

/**
 * Build a router for `addConditionalEdges` matching `gatedNode`'s
 * convention: routes to `blockedNode` if `denialKey` is set in state,
 * otherwise to `allowedNode`.
 */
export function routeOnDenial(
  blockedNode: string,
  allowedNode: string,
  options: { denialKey?: string } = {}
): (state: Record<string, unknown>) => string {
  const denialKey = options.denialKey ?? DEFAULT_DENIAL_KEY;
  return (state: Record<string, unknown>): string => (state[denialKey] !== undefined ? blockedNode : allowedNode);
}
