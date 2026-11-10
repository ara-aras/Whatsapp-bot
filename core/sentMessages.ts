/**
 * IDs of messages this process sent.
 *
 * Baileys echoes every message we send back through `messages.upsert` on the
 * next tick. Those echoes are `fromMe`, and `fromMe` is treated as the owner,
 * so an echo that is not recognised as ours would be handled as an owner
 * message (and a reply starting with "!!" as an owner command).
 *
 * The ID is therefore chosen and recorded here, synchronously, BEFORE the
 * send. Recording it after the send (the old Redis-only approach) raced the
 * echo. Redis still keeps a copy so a restart mid-flight is covered too.
 */
const TTL_MS = 10 * 60 * 1000;
const MAX_TRACKED = 5000;

const sent = new Map<string, number>();

function prune(now: number): void {
  for (const [id, at] of sent) {
    if (now - at > TTL_MS) sent.delete(id);
  }
  for (const id of sent.keys()) {
    if (sent.size <= MAX_TRACKED) break;
    sent.delete(id);
  }
}

export function rememberSentId(id: string | null | undefined, now = Date.now()): void {
  if (!id) return;
  sent.set(id, now);
  if (sent.size > MAX_TRACKED) prune(now);
}

export function wasSentByThisProcess(id: string | null | undefined, now = Date.now()): boolean {
  if (!id) return false;
  const at = sent.get(id);
  if (at === undefined) return false;
  if (now - at > TTL_MS) {
    sent.delete(id);
    return false;
  }
  return true;
}

/** Test hook. */
export function resetSentIds(): void {
  sent.clear();
}
