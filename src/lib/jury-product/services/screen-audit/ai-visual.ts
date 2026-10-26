/**
 * I-066: optional AI visual evaluation. DEFAULT OFF. No model client is wired here, so nothing paid runs in
 * dev/test; a caller must pass an evaluator explicitly AND turn the flag on. Input is limited to masked
 * screenshot keys and numeric layout metrics (no page text, no credentials). The output is advisory only and
 * never changes the rule-based area status.
 */
export const SCREEN_AUDIT_AI_ENABLED = false as boolean;
export const AI_VISUAL_MAX_SHOTS = 4;

export type AiVisualInput = { shots: { storageKey: string; viewport: string; path: string }[]; metrics: { viewport: string; path: string; metrics: unknown }[] };
export type AiVisualNote = { viewport: string; path: string; note: string };
export type AiVisualEvaluator = (input: AiVisualInput) => Promise<AiVisualNote[]>;
export type AiVisualResult = { state: 'OFF' } | { state: 'NOT_CONFIGURED' } | { state: 'DONE'; notes: AiVisualNote[] } | { state: 'ERROR' };

export async function evaluateVisual(input: AiVisualInput, opts: { enabled?: boolean; evaluator?: AiVisualEvaluator | null } = {}): Promise<AiVisualResult> {
  if (!(opts.enabled ?? SCREEN_AUDIT_AI_ENABLED)) return { state: 'OFF' };
  if (!opts.evaluator) return { state: 'NOT_CONFIGURED' };
  const shots = input.shots.filter((s) => /^[\w-]+\/[\w-]+\/[a-f0-9]{64}\.jpg$/.test(s.storageKey)).slice(0, AI_VISUAL_MAX_SHOTS);
  try {
    const notes = await opts.evaluator({ shots, metrics: input.metrics.slice(0, 16) });
    return { state: 'DONE', notes: notes.slice(0, 20).map((n) => ({ viewport: String(n.viewport), path: String(n.path), note: String(n.note).slice(0, 300) })) };
  } catch {
    return { state: 'ERROR' };
  }
}
