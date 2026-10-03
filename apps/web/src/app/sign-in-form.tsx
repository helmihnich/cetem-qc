import type { FormEvent } from "react";
import { fr } from "@cetem-qc/i18n";

export function ResponsableSignInForm({ email, password, busy, onEmailChange, onPasswordChange, onSubmit }: {
  email: string;
  password: string;
  busy: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <>
    <form onSubmit={onSubmit} className="auth-form"><label>{fr.auth.email}<input type="email" autoComplete="username" required value={email} onChange={(event) => onEmailChange(event.target.value)} /></label><label>{fr.auth.password}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => onPasswordChange(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? fr.common.loading : fr.auth.signIn}</button></form>
    <p className="subtitle">{fr.auth.forgotPasswordResponsable}</p>
  </>;
}
