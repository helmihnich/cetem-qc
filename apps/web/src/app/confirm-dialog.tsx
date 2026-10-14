"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { fr } from "@cetem-qc/i18n";
import { Icon } from "./icons";

/**
 * In-page confirmation. Replaces `window.confirm`, which browsers silently answer « non » once dialogs are blocked
 * for the page (and embedded browsers never show), making the guarded action look broken.
 */
export function ConfirmDialog({ title, children, confirmLabel, tone = "primary", busy = false, onConfirm, onCancel }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<Element | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previousFocus.current instanceof HTMLElement) previousFocus.current.focus();
    };
    // The dialog is mounted once per request; `onCancel` only closes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div className="dialog-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-body">
      <div className="dialog-header">
        <span className={`dialog-icon dialog-icon-${tone}`} aria-hidden="true"><Icon name={tone === "danger" ? "alert" : "shield"} size={20} /></span>
        <h2 id="confirm-dialog-title">{title}</h2>
      </div>
      <div id="confirm-dialog-body" className="dialog-body">{children}</div>
      <div className="dialog-actions">
        <button ref={cancelRef} className="secondary-button" type="button" disabled={busy} onClick={onCancel}>{fr.common.cancel}</button>
        <button className={tone === "danger" ? "primary-button danger" : "primary-button"} type="button" disabled={busy} aria-busy={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>;
}
