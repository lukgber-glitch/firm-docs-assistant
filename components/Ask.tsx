// RE: n/a (NEITHER - client component; consumes the NDJSON event protocol of /api/ask)
"use client";

import { useRef, useState, type ReactNode } from "react";

type Source = { n: number; docId: string; chunkIndex: number; docTitle: string; snippet: string; score: number };
type Draft = { passage: number; subject: string; body: string };
type Status = "idle" | "loading" | "streaming" | "done";

const EXAMPLES = [
  "What is your hourly rate for a senior accountant?",
  "Wie lange müssen Sie Buchhaltungsunterlagen aufbewahren?",
  "Which documents do I need to hand in as a new client?",
  "Draft an email to a client explaining how to complain about our service.",
];

/** Turns "[1]" / "[2][3]" in the answer into small badges that highlight the passage in the side panel. */
function renderAnswer(text: string, onCite: (n: number) => void): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return part;
    const n = Number(m[1]);
    return (
      <button key={i} type="button" className="cite" onClick={() => onCite(n)} aria-label={`Show passage ${n}`}>
        {n}
      </button>
    );
  });
}

export function Ask() {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [answer, setAnswer] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [draftBusy, setDraftBusy] = useState<number | null>(null);
  const refs = useRef<Record<number, HTMLLIElement | null>>({});

  const reset = () => {
    setAnswer("");
    setRefusal(null);
    setError(null);
    setSources([]);
    setDrafts([]);
    setActive(null);
  };

  const cite = (n: number) => {
    setActive(n);
    refs.current[n]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  async function submit(q: string) {
    const text = q.trim();
    if (!text || status === "loading" || status === "streaming") return;
    reset();
    setAsked(text);
    setStatus("loading");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? "Something went wrong. Please try again.");
        setStatus("done");
        return;
      }
      setStatus("streaming");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const ev = JSON.parse(buf.slice(0, nl)) as { type: string } & Record<string, unknown>;
          buf = buf.slice(nl + 1);
          if (ev.type === "sources") setSources(ev.sources as Source[]);
          else if (ev.type === "text") setAnswer((a) => a + (ev.delta as string));
          else if (ev.type === "draft") setDrafts((d) => [...d, ev.draft as Draft]);
          else if (ev.type === "refusal") setRefusal(ev.text as string);
          else if (ev.type === "done" && ev.refused) setRefusal("I can't find this in the documents.");
          else if (ev.type === "error") setError(ev.message as string);
        }
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setStatus("done");
  }

  async function draftFor(s: Source) {
    setDraftBusy(s.n);
    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: asked, docId: s.docId, chunkIndex: s.chunkIndex, n: s.n }),
      });
      const body = (await res.json()) as { draft?: Draft; message?: string };
      if (body.draft) setDrafts((d) => [...d, body.draft!]);
      else setError(body.message ?? "Could not create a draft.");
    } catch {
      setError("Network error. Please try again.");
    }
    setDraftBusy(null);
  }

  const busy = status === "loading" || status === "streaming";
  const shown = refusal ? [] : sources;

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(question);
        }}
      >
        <label htmlFor="q">Your question</label>
        <textarea id="q" value={question} maxLength={500} rows={3} placeholder="e.g. How long do you keep client files after an engagement ends?" onChange={(e) => setQuestion(e.target.value)} />
        <div className="row">
          <span className="count">{question.length}/500</span>
          <button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Working…" : "Ask"}
          </button>
        </div>
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="chip" disabled={busy} onClick={() => { setQuestion(ex); void submit(ex); }}>
              {ex}
            </button>
          ))}
        </div>
      </form>

      {(status !== "idle") && (
        <div className="grid">
          <section aria-live="polite" className="answer">
            <h2>Answer</h2>
            {error && <p className="notice err">{error}</p>}
            {refusal && <p className="notice">{refusal}</p>}
            {!refusal && !error && (
              <>
                <p className="body">{answer ? renderAnswer(answer, cite) : status === "loading" ? "Searching the documents…" : null}</p>
                {answer && <p className="label">AI-generated answer — check the cited sources.</p>}
              </>
            )}
            {drafts.map((d, i) => (
              <DraftBox key={i} draft={d} />
            ))}
          </section>

          <aside className="sources">
            <h2>Cited passages</h2>
            {shown.length === 0 && <p className="muted">{refusal ? "No passage was relevant enough." : "Passages appear here."}</p>}
            <ol>
              {shown.map((s) => (
                <li key={s.n} ref={(el) => { refs.current[s.n] = el; }} className={active === s.n ? "active" : ""}>
                  <div className="meta">
                    <span className="num">[{s.n}]</span> <strong>{s.docTitle}</strong>
                    <span className="score" title="cosine similarity">similarity {s.score.toFixed(3)}</span>
                  </div>
                  <p className="snippet">{s.snippet.length > 320 ? s.snippet.slice(0, 320).trimEnd() + "…" : s.snippet}</p>
                  <button type="button" className="link" disabled={busy || draftBusy !== null} onClick={() => void draftFor(s)}>
                    {draftBusy === s.n ? "Drafting…" : "Draft client email from this passage"}
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </>
  );
}

function DraftBox({ draft }: { draft: Draft }) {
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  return (
    <div className="draft">
      <h3>Email draft (grounded in [{draft.passage}])</h3>
      <input aria-label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea aria-label="Email body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
      <p className="label">Draft only. Nothing is sent. Edit it, then copy it into your mail client.</p>
    </div>
  );
}
