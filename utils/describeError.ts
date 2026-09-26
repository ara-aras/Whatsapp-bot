/**
 * One-line description of an error that never comes out empty.
 *
 * A failed multi-address TCP connect throws an AggregateError whose own
 * message is "" - the reasons live in `.errors`. Logging `error.message`
 * alone printed "Neon auth storage unavailable ()", which hid a plain
 * connect timeout.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { code?: string; errors?: unknown[]; address?: string; port?: number };
  const head = [e.name, e.code, e.message].filter(Boolean).join(": ");
  if (!Array.isArray(e.errors) || e.errors.length === 0) return head;
  const inner = e.errors.map((x) => {
    const i = x as { code?: string; message?: string; address?: string; port?: number };
    const where = i.address ? ` ${i.address}${i.port ? `:${i.port}` : ""}` : "";
    return `${i.code || i.message || String(x)}${where}`;
  });
  return `${head} [${inner.join(", ")}]`;
}
