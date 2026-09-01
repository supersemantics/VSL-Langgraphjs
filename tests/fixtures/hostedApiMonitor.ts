/**
 * Test fixtures for the hosted-API detection heuristic.
 *
 * directHostedMonitor's own body mentions "anthropic" directly -- this is
 * caught by the TS heuristic (a plain Function.prototype.toString() scan
 * of the function's own source).
 *
 * indirectHostedMonitor is the same shape as Python vsl-langgraph's real
 * primary fixture (matching the actual chatReplyAgent -> judgeConfidence
 * relationship): the "anthropic" mention lives only inside a helper
 * function it calls, not in its own body. Python's version catches this
 * via an indirection walk with no JS equivalent (see adapter.ts's
 * reachesHostedApi docstring) -- the TS heuristic does NOT catch this
 * case, by disclosed design, not by oversight.
 */

import { GammaEstimate } from "@supersemantics/vsl-core";

export async function directHostedMonitor(_candidateInput: unknown): Promise<GammaEstimate> {
  // Real integration: const client = new Anthropic({ apiKey: ... });
  //                   return await client.messages.create(...);
  return new GammaEstimate({ gammaHat: 2.0 });
}

export async function directHostedRule(_candidateInput: unknown): Promise<boolean> {
  // Real integration: const client = new Anthropic({ apiKey: ... });
  return true;
}

// Deliberately generic name -- no marker substring in the identifier
// itself, matching the real chatReplyAgent -> judgeConfidence relationship
// this fixture models. The marker only lives inside this function's own
// body, not in how callers refer to it.
async function judgeConfidence(_prompt: string): Promise<string> {
  // Real integration: const client = new Anthropic({ apiKey: ... });
  //                   return (await client.messages.create(...)).content;
  return "PASS";
}

export async function indirectHostedMonitor(candidateInput: unknown): Promise<GammaEstimate> {
  // This function's OWN source text (what Function.prototype.toString()
  // returns) contains only "judgeConfidence" -- no hosted-API marker.
  // The marker lives inside judgeConfidence's own body above, reachable
  // only via the indirection walk this port doesn't implement.
  const verdict = await judgeConfidence(String(candidateInput));
  return new GammaEstimate({ gammaHat: verdict === "PASS" ? 2.0 : 0.0 });
}
