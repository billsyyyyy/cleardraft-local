"use client";

import { FormEvent, KeyboardEvent, useMemo, useState } from "react";

type WritingMode = "academic" | "clinical";
type Strength = "light" | "moderate" | "strong";
type ModelState = "idle" | "loading" | "ready" | "working" | "error";

const MODEL_ID = "qwen3:4b";
const OLLAMA_URL = "http://127.0.0.1:11434";
const SAMPLE_DRAFT = `During the hospice visit, the nurse assessed the patient’s comfort and explained each action before beginning care. The caregiver expressed concern about the patient becoming sleepy after receiving morphine. The nurse listened to the concern, reviewed the medication instructions, and used teach-back to confirm understanding. In my future practice, I will assess the caregiver’s specific concerns before providing clear medication education.`;
const CLINICAL_TERMS = ["morphine", "teach-back", "hospice", "patient", "caregiver"];

const strengthCopy: Record<Strength, string> = {
  light: "Correct grammar and awkward phrasing. Change only what is necessary.",
  moderate: "Improve flow, clarity, and sentence variety while keeping the writer’s structure recognizable.",
  strong: "Reshape repetitive or robotic passages more fully while preserving every claim and detail.",
};

const modeCopy: Record<WritingMode, string> = {
  academic: "Use a direct, natural college-student voice. Keep the writing formal enough for coursework without inflated academic language.",
  clinical: "Use accurate clinical language and a direct nursing-student voice. Preserve symptoms, assessments, interventions, medications, patient responses, and clinical sequence.",
};

function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]) {
  return values.filter((value, index) => value.trim() && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index);
}

function protectDraft(source: string, protectedTerms: string[]) {
  const preserved: string[] = [];
  let masked = source;
  const patterns = [
    /https?:\/\/[^\s)]+/gi,
    /\b(?:doi:\s*)?10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi,
    /\b[A-Z][A-Za-z'’-]+(?:\s+et al\.)?\s*\((?:19|20)\d{2}[a-z]?\)/g,
    /\([^()\n]*(?:19|20)\d{2}[a-z]?[^()\n]*\)/g,
    /“[^”\n]+”|"[^"\n]+"/g,
    /\b\d+(?:\.\d+)?\s?(?:mcg|mg|g|kg|mL|L|mEq\/L|g\/dL|mmHg|bpm|%|°F|°C|hours?|days?|weeks?|months?|years?)\b/gi,
  ];
  const replaceMatch = (match: string) => {
    const existing = preserved.findIndex((item) => item === match);
    const index = existing >= 0 ? existing : preserved.push(match) - 1;
    return `<<<P${index}>>>`;
  };
  for (const pattern of patterns) masked = masked.replace(pattern, replaceMatch);
  const sortedTerms = unique(protectedTerms).map((term) => term.trim()).sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) masked = masked.replace(new RegExp(escapeRegExp(term), "gi"), replaceMatch);
  return { masked, preserved };
}

function restoreProtected(output: string, preserved: string[]) {
  let restored = output.trim();
  const missing: string[] = [];
  preserved.forEach((value, index) => {
    const placeholder = new RegExp(`<{2,3}\\s*P\\s*${index}\\s*>{2,3}|\\[+\\s*P\\s*${index}\\s*\\]+`, "gi");
    if (placeholder.test(restored)) restored = restored.replace(placeholder, value);
    else if (!restored.toLowerCase().includes(value.toLowerCase())) missing.push(value);
  });
  return { restored, missing };
}

function buildSystemPrompt(mode: WritingMode, strength: Strength) {
  return `You are a conservative academic writing editor. Rewrite the supplied draft in the writer's own plainspoken voice.

STYLE PROFILE
- Sound like a thoughtful college nursing student: clear, direct, reflective, and natural.
- Prefer active sentences and familiar words.
- Vary sentence length and sentence openings without creating fragments.
- Improve mechanical patterns such as repeated openings, uniform sentence structures, literal repetition, and generic transitions.
- For Moderate or Strong rewrites, make meaningful structural edits rather than returning the source unchanged or merely replacing words with synonyms.
- Avoid inflated language, filler, generic conclusions, three-part rhetorical lists, em dashes, and the structures “not only X but also Y” and “from X to Y.”
- Do not use these words unless the source requires them: nuanced, multifaceted, complex, highlights, underscores, underlying, sheds light, stark, interplay, realm, tapestry, emphasized, ensuring.

NONNEGOTIABLE SAFETY RULES
- Preserve the original meaning, facts, names, pronouns, chronology, numbers, quotations, citations, and medical terminology.
- Never add a diagnosis, medication instruction, clinical interpretation, citation, statistic, event, or personal experience.
- Text between markers such as <<<P0>>> is protected. Copy every protected marker exactly once and do not move it to a different claim.
- Keep the same point of view. Do not make the writer sound more certain than the source.
- Return only the revised draft. Do not explain your edits or add a heading.

MODE: ${modeCopy[mode]}
STRENGTH: ${strengthCopy[strength]}`;
}

function tokenize(value: string) {
  return value.match(/\s+|[\p{L}\p{N}’'-]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function highlightedRevision(original: string, revision: string) {
  const originalWords = new Set(tokenize(original).filter((token) => /[\p{L}\p{N}]/u.test(token)).map((token) => token.toLowerCase()));
  return tokenize(revision).map((token, index) => {
    const changed = /[\p{L}\p{N}]/u.test(token) && !originalWords.has(token.toLowerCase());
    return changed ? <mark className="change" key={`${token}-${index}`}>{token}</mark> : <span key={`${token}-${index}`}>{token}</span>;
  });
}

export default function Home() {
  const [mode, setMode] = useState<WritingMode>("academic");
  const [strength, setStrength] = useState<Strength>("moderate");
  const [draft, setDraft] = useState("");
  const [revision, setRevision] = useState("");
  const [protectedTerms, setProtectedTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [modelState, setModelState] = useState<ModelState>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Ollama has not been checked");
  const [warning, setWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const draftWords = useMemo(() => wordCount(draft), [draft]);
  const revisionWords = useMemo(() => wordCount(revision), [revision]);

  function addTerm(rawValue = termInput) {
    const additions = rawValue.split(",").map((term) => term.trim()).filter(Boolean);
    if (!additions.length) return;
    setProtectedTerms((current) => unique([...current, ...additions]));
    setTermInput("");
  }

  function handleTermSubmit(event: FormEvent) {
    event.preventDefault();
    addTerm();
  }

  function handleTermKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === ",") {
      event.preventDefault();
      addTerm();
    }
  }

  async function ensureOllama() {
    setModelState("loading");
    setStatusMessage("Connecting to Ollama on this computer");
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("ClearDraft could not connect to Ollama.");
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    const available = data.models?.some((item) => (item.name || item.model || "").startsWith("qwen3:4b"));
    if (!available) throw new Error("Ollama is running, but qwen3:4b is not installed.");
    setModelState("ready");
    setProgress(100);
    setStatusMessage("Ollama connected · Qwen 3 4B ready");
  }

  async function requestOllama(maskedDraft: string, retry = false) {
    const retryInstruction = retry
      ? "\n\nThe previous attempt was invalid because it returned planning, commentary, or unchanged text. Return a clean revision now. Make meaningful structural edits while preserving every fact and protected marker. Change sentence openings, combine or split sentences where helpful, and remove repetition. Do not use synonym spinning."
      : "";
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: "system", content: "OUTPUT RULE: Return only the revised draft. Never show analysis, reasoning, planning, notes, headings, or explanations.\n\n" + buildSystemPrompt(mode, strength) + retryInstruction },
          { role: "user", content: `/no_think\n\nRewrite the draft below. Output only the revised draft:\n\n${maskedDraft}` },
        ],
        stream: false,
        keep_alive: "30m",
        options: {
          temperature: retry ? 0.2 : strength === "light" ? 0.2 : strength === "moderate" ? 0.4 : 0.55,
          top_p: 0.9,
          repeat_penalty: 1.08,
          num_predict: Math.min(1600, Math.max(260, Math.ceil(draftWords * 1.6))),
        },
      }),
    });
    if (!response.ok) throw new Error(`Ollama returned an error (${response.status}).`);
    const result = await response.json() as { message?: { content?: string } };
    const raw = result.message?.content?.trim() || "";
    const content = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (!content) throw new Error("Ollama returned an empty revision.");
    return content;
  }

  async function refineDraft() {
    if (!draft.trim() || modelState === "loading" || modelState === "working") return;
    setWarning("");
    setCopied(false);
    try {
      await ensureOllama();
      setModelState("working");
      setStatusMessage("Qwen is revising on your computer");
      const { masked, preserved } = protectDraft(draft, [...protectedTerms, ...(mode === "clinical" ? CLINICAL_TERMS : [])]);
      let content = await requestOllama(masked);
      const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
      const containsPlanning = (value: string) => /(?:okay,? the user|the user wants|looking at (?:their|the) requirements|let me (?:structure|rewrite|think)|important safety check|why this works|other natural options|here(?:'|’)s a .*rewrite|done thinking)/i.test(value);
      if ((normalize(content) === normalize(masked) && strength !== "light") || containsPlanning(content)) {
        setStatusMessage("Retrying without Qwen's planning text");
        content = await requestOllama(masked, true);
      }
      if (containsPlanning(content)) throw new Error("Qwen returned planning instead of a revision. Please try once more.");
      const { restored, missing } = restoreProtected(content, preserved);
      setRevision(restored);
      setWarning(missing.length ? `Review needed: the model may have changed ${missing.length} protected item${missing.length === 1 ? "" : "s"}. Compare the highlighted revision before using it.` : "Protection check passed. Review the revision for meaning before submitting it.");
      setModelState("ready");
      setStatusMessage("Ollama connected · Qwen 3 4B ready");
    } catch (error) {
      setModelState("error");
      setStatusMessage("Ollama connection unavailable");
      setWarning(error instanceof Error ? error.message : "ClearDraft could not connect to Ollama. Make sure the Ollama app is open, then try again.");
    }
  }

  async function copyRevision() {
    if (!revision) return;
    await navigator.clipboard.writeText(revision);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function downloadRevision() {
    if (!revision) return;
    const file = new Blob([revision], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cleardraft-revision.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  function restart() {
    setDraft(""); setRevision(""); setProtectedTerms([]); setTermInput(""); setWarning(""); setCopied(false); setMode("academic"); setStrength("moderate");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Personal academic editor</p><h1>ClearDraft Local</h1></div>
        <div className="privacy-badge" aria-label="Private and on-device"><span className="shield" aria-hidden="true">✓</span><span><strong>Private</strong> · On-device</span></div>
      </header>

      <section className="workspace" aria-label="Writing workspace">
        <div className={`model-strip ${modelState}`} role="status" aria-live="polite"><span className="status-dot" aria-hidden="true" /><span>{statusMessage}</span>
          {modelState === "idle" && <span className="model-note">Uses Qwen 3 4B through the Ollama app on this computer.</span>}
          {modelState === "loading" && <div className="progress-track" aria-label={`Model download ${progress}%`}><span style={{ width: `${progress}%` }} /></div>}
        </div>

        <div className="editor-grid">
          <article className="editor-card input-card">
            <header className="editor-header"><div><p className="card-kicker">Your words</p><h2>Original Draft</h2></div><span className="word-count">{draftWords} words</span></header>
            <div className="editor-tools"><span>{mode === "academic" ? "Academic voice" : "Clinical voice"}</span><button onClick={() => setDraft(SAMPLE_DRAFT)} type="button">Try sample</button></div>
            <textarea aria-label="Original draft" onChange={(event) => { setDraft(event.target.value); setRevision(""); setWarning(""); }} placeholder="Paste your draft here. Your text remains on this device while the local model revises it." spellCheck value={draft} />
            <footer className="editor-footer"><span>{draftWords} words</span><button disabled={!draft} onClick={() => setDraft("")} type="button">Clear</button></footer>

            <section className="options-panel" aria-label="Rewrite options">
              <div className="options-heading"><div><p className="card-kicker">Rewrite settings</p><h3>Choose how the draft should sound</h3></div><span>Processed privately on your device</span></div>
              <div className="options-grid">
                <fieldset className="control-group"><legend>Writing mode</legend><div className="segmented">
                  {(["academic", "clinical"] as WritingMode[]).map((option) => <button className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)} type="button">{option[0].toUpperCase() + option.slice(1)}</button>)}
                </div></fieldset>
                <fieldset className="control-group"><legend>Rewrite strength</legend><div className="segmented">
                  {(["light", "moderate", "strong"] as Strength[]).map((option) => <button className={strength === option ? "active" : ""} key={option} onClick={() => setStrength(option)} type="button">{option[0].toUpperCase() + option.slice(1)}</button>)}
                </div></fieldset>
              </div>
              <form className="term-form" onSubmit={handleTermSubmit}><label htmlFor="protected-term">Protected terms</label><div className="term-entry">
                <input id="protected-term" onChange={(event) => setTermInput(event.target.value)} onKeyDown={handleTermKeyDown} placeholder="Names, diagnoses, medications, or citations" value={termInput} />
                <button type="submit" aria-label="Add protected term">Add</button>
              </div></form>
              {protectedTerms.length > 0 && <div className="term-chips" aria-label="Protected terms"><span className="chip-label">Protected:</span>{protectedTerms.map((term) => <button className="term-chip" key={term} onClick={() => setProtectedTerms((current) => current.filter((item) => item !== term))} title={`Remove ${term}`} type="button">{term}<span aria-hidden="true"> ×</span></button>)}</div>}
              <div className="rewrite-row"><div className="trust-copy"><span className="shield small" aria-hidden="true">✓</span><span>Facts, citations, and clinical terms stay protected.</span></div>
                <button className="primary-action" disabled={!draft.trim() || modelState === "loading" || modelState === "working"} onClick={refineDraft} type="button">
                  {modelState === "loading" ? "Connecting to Ollama…" : modelState === "working" ? "Rewriting…" : "Rewrite Draft"}
                </button>
              </div>
            </section>
          </article>

          <article className="editor-card">
            <header className="editor-header"><div><p className="card-kicker">Conservative revision</p><h2>Clear Revision</h2></div><span className={`readiness ${revision ? "complete" : ""}`}><span className="status-dot" aria-hidden="true" />{revision ? "Ready" : "Waiting"}</span></header>
            <div className="editor-tools"><span>New wording is highlighted</span><span>{revisionWords} words</span></div>
            <div className={`revision-output ${!revision ? "empty" : ""}`} aria-live="polite">{revision ? highlightedRevision(draft, revision) : "Your revision will appear here. ClearDraft does not send your writing to a paid service or external API."}</div>
            <footer className="editor-footer action-footer"><span>{warning || "Always review AI-assisted edits before submission."}</span><div>
              <button disabled={!revision} onClick={copyRevision} type="button">{copied ? "Copied" : "Copy"}</button><button disabled={!revision} onClick={downloadRevision} type="button">Download</button><button disabled={!draft && !revision} onClick={restart} type="button">Restart</button>
            </div></footer>
          </article>
        </div>

        <aside className="integrity-note"><strong>Built for careful editing, not detector guarantees.</strong><span>AI-detection scores can be wrong. Use the revision to improve clarity and keep responsibility for the final work.</span></aside>
      </section>
    </main>
  );
}
