"use client";

import { useId, useState } from "react";
import { fr } from "@cetem-qc/i18n";
import { Icon } from "./icons";

/** Lower-cased and accent-free, so « etablissement » finds « Établissement ». */
export const normalizeText = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Client-side match of already-loaded rows: every word of the query must appear in one of the fields. */
export function matchesQuery(fields: ReadonlyArray<string | null | undefined>, query: string): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText(fields.filter((field): field is string => typeof field === "string").join(" "));
  return words.every((word) => haystack.includes(word));
}

/** Placeholder rows while a list loads. The status text stays first so assistive technology announces it. */
export function LoadingSkeleton({ rows = 4, variant = "table" }: { rows?: number; variant?: "table" | "panel" }) {
  return <div className={`loading-skeleton loading-skeleton-${variant}`} role="status">{fr.common.loading}<span className="skeleton-lines" aria-hidden="true">
    {Array.from({ length: rows }, (_, index) => <span className="skeleton-row" key={index}><span /><span /><span /></span>)}
  </span></div>;
}

/** Search box for filtering rows already on screen; Escape clears it. */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="search-field">
    <Icon name="search" size={16} />
    <input type="search" aria-label={fr.shell.filters.search} placeholder={placeholder} value={value} autoComplete="off" spellCheck={false}
      onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape" && value) { event.preventDefault(); onChange(""); } }} />
    {value && <button className="icon-button search-clear" type="button" aria-label={fr.shell.filters.clearSearch} title={fr.shell.filters.clearSearch} onClick={() => onChange("")}><Icon name="close" size={14} /></button>}
  </div>;
}

/** Password input with a show/hide toggle. The toggle sits outside the label so the input keeps its plain name. */
export function PasswordField({ label, value, onChange, autoComplete, minLength, required = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return <div className="form-field">
    <label htmlFor={id}>{label}</label>
    <span className="password-field">
      <input id={id} type={visible ? "text" : "password"} autoComplete={autoComplete} required={required} {...(minLength ? { minLength } : {})} value={value} onChange={(event) => onChange(event.target.value)} />
      <button className="icon-button password-toggle" type="button" aria-pressed={visible} aria-label={fr.shell.showPassword} title={visible ? fr.shell.hidePassword : fr.shell.showPassword} onClick={() => setVisible((current) => !current)}>
        <Icon name={visible ? "eyeOff" : "eye"} size={18} />
      </button>
    </span>
  </div>;
}
