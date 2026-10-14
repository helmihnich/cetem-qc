import type { FormEvent } from "react";
import { fr } from "@cetem-qc/i18n";
import { PasswordField } from "./ui";

export function ResponsableSignInForm({ email, password, busy, onEmailChange, onPasswordChange, onSubmit }: {
  email: string;
  password: string;
  busy: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <>
    <form onSubmit={onSubmit} className="auth-form"><label>{fr.auth.email}<input type="email" autoComplete="username" required value={email} onChange={(event) => onEmailChange(event.target.value)} /></label><PasswordField label={fr.auth.password} autoComplete="current-password" value={password} onChange={onPasswordChange} /><button className="primary-button" disabled={busy} aria-busy={busy}>{busy ? fr.common.loading : fr.auth.signIn}</button></form>
    <p className="subtitle">{fr.auth.forgotPasswordResponsable}</p>
  </>;
}
