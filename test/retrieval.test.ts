import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "../lib/db";
import { REFUSAL_TEXT } from "../lib/config";
import { answerStream } from "../lib/llm";
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

/**
 * Cross-language: the answer exists ONLY in a document written in the other language than the question.
 * Each must hit the right doc first AND clear the refusal threshold (which must not be lowered to make this pass).
 */
const DE_TO_EN: [string, string][] = [
  ["Welche Unterlagen brauchen Sie beim Onboarding eines neuen Mandanten?", "client-onboarding-checklist"],
  ["Wie reiche ich eine Beschwerde über Ihren Service ein?", "complaints-procedure"],
  ["Wie hoch ist der Stundensatz für einen Partner?", "fee-policy"],
  ["Wie sind Ihre Öffnungszeiten am Freitag?", "office-hours-contact"],
  ["Darf ich im Homeoffice Mandantendaten auf privaten USB-Sticks speichern?", "memo-remote-work-client-data"],
  ["Welche Verzugszinsen fallen bei einer verspäteten Zahlung an?", "fee-policy"],
];
const EN_TO_DE: [string, string][] = [
  ["How long do you keep accounting records and invoices?", "aufbewahrungsrichtlinie"],
  ["Do you share my personal data with third parties?", "datenschutzhinweis"],
  ["What is the internal deadline for VAT return documents?", "fristenkalender-2027"],
  ["How long after the end of the mandate do I get my original documents back?", "mandatsende"],
  ["What is the four-eyes principle for deadlines?", "memo-fristenkontrolle"],
  ["Can I pay my invoice in instalments?", "haeufige-fragen-mandanten"],
];

describe("cross-language retrieval (query expansion)", () => {
  it.each([...DE_TO_EN, ...EN_TO_DE])("%s -> %s above the threshold", async (q, doc) => {
    const hit = await top(q);
    console.log(`XL ${hit.score.toFixed(3)} ${hit.docId} | ${q}`);
    expect(hit.docId).toBe(doc);
    expect(hit.score).toBeGreaterThanOrEqual(REFUSAL_THRESHOLD);
  });

  it("off-topic questions in both languages stay below the threshold", async () => {
    const qs = [
      "What is the capital of Peru?",
      "Welches ist der höchste Berg der Welt?",
      "Wie backe ich einen Apfelkuchen?",
    ];
    for (const q of qs) {
      const hit = await top(q);
      console.log(`OFF ${hit.score.toFixed(3)} ${hit.docId} | ${q}`);
      expect(hit.score, q).toBeLessThan(REFUSAL_THRESHOLD);
    }
  });

  // Some off-topic questions score ABOVE the floor and a similarity floor cannot separate them:
  // "Explain quantum computing" (~0.82 before and after query expansion) and "Wie funktioniert ein Verbrennungsmotor?"
  // (0.776 before expansion, ~0.83 after: the English expansion "How does ... work" matches the English remote-work memo).
  // Stage 2, the model's refusal rule, must catch them.
  it.each(["Explain quantum computing", "Wie funktioniert ein Verbrennungsmotor?"])(
    "off-topic above the floor is refused by the model (stage 2): %s",
    async (q) => {
      const hits = await retrieve(q, 4);
      console.log(`OFF ${hits[0]!.score.toFixed(3)} ${hits[0]!.docId} | ${q} (stage 2)`);
      if (hits[0]!.score < REFUSAL_THRESHOLD) return; // already refused at stage 1
      const { result } = answerStream(q, hits);
      expect((await result.text).trim()).toBe(REFUSAL_TEXT);
    },
  );
});
