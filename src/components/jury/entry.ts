export type JuryEntrySurface = 'landing' | 'console';

/** Unauthenticated visitors see the product landing. Every other actor stays on the console gate. */
export function juryEntrySurface(actor: { ok: boolean; reason?: string }): JuryEntrySurface {
  if (!actor.ok && actor.reason === 'UNAUTHENTICATED') return 'landing';
  return 'console';
}
