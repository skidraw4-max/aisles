// Custom node:test reporter: emits one JSON line per event of interest.
// Used by scripts/test-baseline.mjs. No dependencies.
export default async function* reporter(source) {
  for await (const event of source) {
    if (event.type === "test:fail" || event.type === "test:pass") {
      const d = event.data;
      const isSuite = d.details?.type === "suite";
      yield JSON.stringify({
        status: event.type === "test:fail" ? "fail" : "pass",
        file: d.file ?? null,
        name: d.name,
        nesting: d.nesting,
        suite: isSuite,
        error: event.type === "test:fail" ? String(d.details?.error?.cause?.message ?? d.details?.error?.message ?? "").slice(0, 300) : undefined,
      }) + "\n";
    }
  }
}
