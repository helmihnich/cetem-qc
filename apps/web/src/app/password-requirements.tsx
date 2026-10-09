import { PASSWORD_RULES, checkPasswordRules } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";

/** Live checklist of the password policy; each rule turns green once the typed password satisfies it. */
export function PasswordRequirements({ password }: { password: string }) {
  const results = checkPasswordRules(password);
  return <div className="password-rules" aria-live="polite">
    <p>{fr.auth.passwordRequirements}</p>
    <ul>{PASSWORD_RULES.map((rule) => <li key={rule} className={results[rule] ? "met" : undefined}>
      <span aria-hidden="true">{results[rule] ? "✓" : "○"}</span> {fr.auth.passwordRules[rule]}
    </li>)}</ul>
  </div>;
}
