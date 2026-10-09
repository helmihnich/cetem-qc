export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRule = "length" | "uppercase" | "lowercase" | "digit" | "special";

const ruleChecks: Record<PasswordRule, (password: string) => boolean> = {
  length: (password) => password.length >= PASSWORD_MIN_LENGTH,
  uppercase: (password) => /[A-Z]/.test(password),
  lowercase: (password) => /[a-z]/.test(password),
  digit: (password) => /[0-9]/.test(password),
  special: (password) => /[^A-Za-z0-9]/.test(password),
};

export const PASSWORD_RULES = Object.keys(ruleChecks) as PasswordRule[];

/** Per-rule results, in display order, so forms can show which requirements are met. */
export function checkPasswordRules(password: string): Record<PasswordRule, boolean> {
  return Object.fromEntries(PASSWORD_RULES.map((rule) => [rule, ruleChecks[rule](password)])) as Record<PasswordRule, boolean>;
}

export function isPasswordCompliant(password: string): boolean {
  return PASSWORD_RULES.every((rule) => ruleChecks[rule](password));
}
