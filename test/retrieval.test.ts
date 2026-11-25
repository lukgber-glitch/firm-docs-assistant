import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "../lib/db";
import { REFUSAL_THRESHOLD, retrieve } from "../lib/retrieval";

afterAll(async () => {
  await closePool();
});

const top = async (q: string) => (await retrieve(q, 4))[0]!;

describe("retrieval (real splitter + local e5 embeddings + pgvector)", () => {
  it("German question about retention periods -> retention policy", async () => {
    const hit = await top("Wie lange müssen Sie Buchhaltungsunterlagen aufbewahren?");
    expect(hit.docId).toBe("aufbewahrungsrichtlinie");
  });

  it("English fee question -> fee policy", async () => {
    const hit = await top("What is your hourly rate for a senior accountant?");
    expect(hit.docId).toBe("fee-policy");
  });

  it("English onboarding question -> onboarding checklist", async () => {
    const hit = await top("Which documents do I need to hand in when I become a new client?");
    expect(hit.docId).toBe("client-onboarding-checklist");
  });

  it("German data-protection question -> privacy notice", async () => {
    const hit = await top("An wen geben Sie meine personenbezogenen Daten weiter?");
    expect(hit.docId).toBe("datenschutzhinweis");
  });

  it("cross-lingual: English question finds the German mandate-end document", async () => {
    const hits = await retrieve("How long do I keep portal access after the mandate ends?", 4);
    expect(hits[0]!.docId).toBe("mandatsende");
  });

  it("every in-corpus question scores above the refusal threshold", async () => {
    const qs = [
      "Wie lange müssen Sie Buchhaltungsunterlagen aufbewahren?",
      "What is your hourly rate for a senior accountant?",
      "Bis wann muss ich Belege für die Umsatzsteuervoranmeldung einreichen?",
      "How do I file a complaint about your service?",
    ];
    for (const q of qs) expect((await top(q)).score).toBeGreaterThanOrEqual(REFUSAL_THRESHOLD);
  });

  it("out-of-corpus questions score below the refusal threshold (EN and DE)", async () => {
    for (const q of ["What is the capital of Peru?", "Wie backe ich einen Apfelkuchen?", "Who won the football world cup in 2014?"]) {
      expect((await top(q)).score, q).toBeLessThan(REFUSAL_THRESHOLD);
    }
  });

  it("results are ranked by descending score and carry doc title + snippet", async () => {
    const hits = await retrieve("What are your office hours?", 4);
    expect(hits.length).toBe(4);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1]!.score).toBeGreaterThanOrEqual(hits[i]!.score);
    expect(hits[0]!.docTitle.length).toBeGreaterThan(3);
    expect(hits[0]!.content.length).toBeGreaterThan(20);
  });
});
