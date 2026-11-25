// RE: n/a (NEITHER - single page shell; interactivity lives in components/Ask.tsx)
import { Ask } from "@/components/Ask";

export default function Page() {
  return (
    <main>
      <header>
        <h1>Ask the firm&apos;s documents</h1>
        <p className="sub">
          Retrieval-augmented answers with numbered citations over 13 documents of an invented tax-advisory firm,{" "}
          <strong>Lindner &amp; Vogt Steuerberatung (fictional)</strong>. The corpus is <strong>synthetic sample data</strong>, mixed German and
          English. Ask in either language.
        </p>
      </header>
      <Ask />
      <footer>Demo by Lukas Gruber · synthetic data · no data stored</footer>
    </main>
  );
}
