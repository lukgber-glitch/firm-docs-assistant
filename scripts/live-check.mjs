// RE: n/a (NEITHER - smoke test against the public URL using the same NDJSON protocol as the UI)
// Usage: node scripts/live-check.mjs [baseUrl]   (exit 1 if any of the six checks fails)
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
  report("(a) German question, cited right doc", !/(auf Deutsch|auf Englisch|in German|in English|the question is|die Frage ist)/i.test(a.text) && a.cited.length >= 1 && a.citedDocs.includes("aufbewahrungsrichtlinie"), `Q: ${q1}\n     A: ${short(a.text)}\n     cited docs: ${a.citedDocs.join(", ")}`);

  const q2 = "What is your hourly rate for a senior accountant?";
  const b = await ask(q2);
  report("(b) English question, cited", !/(auf Deutsch|auf Englisch|in German|in English|the question is|die Frage ist)/i.test(b.text) && b.cited.length >= 1, `Q: ${q2}\n     A: ${short(b.text)}\n     cited docs: ${b.citedDocs.join(", ")}`);

  const q3 = "What is the capital of Peru?";
  const c = await ask(q3);
  report("(c) out-of-corpus -> refusal", c.refused && c.text.trim() === "" , `Q: ${q3}\n     A: ${c.events.find((e) => e.type === "refusal")?.text ?? short(c.text)}`);

  const q5 = "Welche Unterlagen brauchen Sie beim Onboarding eines neuen Mandanten?";
  const e = await ask(q5);
  report("(e) German question, answer only in an English doc", !/(auf Deutsch|auf Englisch|in German|in English|the question is|die Frage ist)/i.test(e.text) && e.cited.length >= 1 && e.citedDocs.includes("client-onboarding-checklist"), `Q: ${q5}
     A: ${short(e.text)}
     cited docs: ${e.citedDocs.join(", ")}
     searched as: ${(e.events.find((x) => x.type === "sources")?.queries ?? []).join(" | ")}`);

  const q6 = "How long do you keep accounting records and invoices?";
  const f = await ask(q6);
  report("(f) English question, answer only in a German doc", !/(auf Deutsch|auf Englisch|in German|in English|the question is|die Frage ist)/i.test(f.text) && f.cited.length >= 1 && f.citedDocs.includes("aufbewahrungsrichtlinie"), `Q: ${q6}
     A: ${short(f.text)}
     cited docs: ${f.citedDocs.join(", ")}`);

  const first = b.sources[0] ?? a.sources[0];
  const d = await fetch(`${BASE}/api/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q2, docId: b.sources[0].docId, chunkIndex: b.sources[0].chunkIndex, n: 1 }) });
  const dj = await d.json();
  report("(d) draft step returns an email text", d.ok && typeof dj.draft?.body === "string" && dj.draft.body.length > 40, `source [1]: ${first.docTitle}\n     subject: ${dj.draft?.subject}\n     body: ${short(dj.draft?.body ?? JSON.stringify(dj))}`);
} catch (e) {
  console.error("live-check error:", e instanceof Error ? e.message : e);
  results.push(false);
}
process.exit(results.length === 6 && results.every(Boolean) ? 0 : 1);
