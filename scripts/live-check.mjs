// RE: n/a (NEITHER - smoke test against the public URL using the same NDJSON protocol as the UI)
// Usage: node scripts/live-check.mjs [baseUrl]   (exit 1 if any of the four checks fails)
const BASE = process.argv[2] ?? "https://docs-demo.lgweb.work";

async function ask(question) {
  const res = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  const text = events.filter((e) => e.type === "text").map((e) => e.delta).join("");
  const sources = events.find((e) => e.type === "sources")?.sources ?? [];
  const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
  const citedDocs = [...new Set(cited.map((n) => sources.find((s) => s.n === n)?.docId).filter(Boolean))];
  return { events, text, sources, cited, citedDocs, refused: events.some((e) => e.type === "refusal") || events.some((e) => e.type === "done" && e.refused) };
}

const results = [];
const report = (name, ok, detail) => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}\n     ${detail}`);
};
const short = (s) => s.replace(/\s+/g, " ").slice(0, 150);

try {
  const q1 = "Wie lange müssen Sie Buchhaltungsunterlagen aufbewahren?";
  const a = await ask(q1);
  report("(a) German question, cited right doc", a.cited.length >= 1 && a.citedDocs.includes("aufbewahrungsrichtlinie"), `Q: ${q1}\n     A: ${short(a.text)}\n     cited docs: ${a.citedDocs.join(", ")}`);

  const q2 = "What is your hourly rate for a senior accountant?";
  const b = await ask(q2);
  report("(b) English question, cited", b.cited.length >= 1, `Q: ${q2}\n     A: ${short(b.text)}\n     cited docs: ${b.citedDocs.join(", ")}`);

  const q3 = "What is the capital of Peru?";
  const c = await ask(q3);
  report("(c) out-of-corpus -> refusal", c.refused && c.text.trim() === "" , `Q: ${q3}\n     A: ${c.events.find((e) => e.type === "refusal")?.text ?? short(c.text)}`);

  const first = b.sources[0] ?? a.sources[0];
  const d = await fetch(`${BASE}/api/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q2, docId: b.sources[0].docId, chunkIndex: b.sources[0].chunkIndex, n: 1 }) });
  const dj = await d.json();
  report("(d) draft step returns an email text", d.ok && typeof dj.draft?.body === "string" && dj.draft.body.length > 40, `source [1]: ${first.docTitle}\n     subject: ${dj.draft?.subject}\n     body: ${short(dj.draft?.body ?? JSON.stringify(dj))}`);
} catch (e) {
  console.error("live-check error:", e instanceof Error ? e.message : e);
  results.push(false);
}
process.exit(results.length === 4 && results.every(Boolean) ? 0 : 1);
