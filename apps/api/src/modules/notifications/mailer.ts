import nodemailer from "nodemailer";

type Env = Record<string, string | undefined>;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outgoing e-mail port. `send` resolves once the SMTP server accepted the message and rejects otherwise. */
export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Used when SMTP is not configured: nothing leaves the server and callers report the e-mail as not sent. */
export function createDisabledMailer(): Mailer {
  return { configured: false, send: async () => { throw new Error("SMTP is not configured."); } };
}

/**
 * Selects the mailer from the server environment. With `SMTP_HOST` empty (default) e-mail is disabled. Otherwise
 * `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` are required; `SMTP_PORT` defaults to 587 (STARTTLS, 465 uses implicit TLS).
 * Messages never carry a value.
 */
export function createMailer(env: Env): Mailer {
  const host = env.SMTP_HOST?.trim();
  if (!host) return createDisabledMailer();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASSWORD?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!user || !pass || !from) throw new Error("SMTP_USER, SMTP_PASSWORD and MAIL_FROM must be set when SMTP_HOST is set.");
  const rawPort = env.SMTP_PORT?.trim();
  const port = rawPort ? Number(rawPort) : 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP_PORT must be an integer between 1 and 65535.");
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465, auth: { user, pass },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  return {
    configured: true,
    send: async (message) => { await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text }); },
  };
}

export interface TemporaryCredentialEmail {
  employee: { id: string; firstName: string; email: string };
  temporaryCredential: string;
  reason: "created" | "reset";
  loginUrl?: string;
}

export function temporaryCredentialMessage({ employee, temporaryCredential, reason, loginUrl }: TemporaryCredentialEmail): MailMessage {
  const intro = reason === "created"
    ? "Votre compte CETEM QC a été créé par votre Responsable."
    : "Votre Responsable a réinitialisé le mot de passe de votre compte CETEM QC.";
  return {
    to: employee.email,
    subject: reason === "created" ? "Votre accès CETEM QC" : "Votre nouveau mot de passe temporaire CETEM QC",
    text: [
      `Bonjour ${employee.firstName},`,
      "",
      intro,
      "",
      `Adresse e-mail : ${employee.email}`,
      `Mot de passe temporaire : ${temporaryCredential}`,
      ...(loginUrl ? [`Connexion : ${loginUrl}`] : []),
      "",
      "À votre première connexion, vous devrez choisir votre propre mot de passe. Le mot de passe temporaire ne sera alors plus valable.",
      "",
      "Si vous n’attendiez pas ce message, prévenez votre Responsable.",
    ].join("\n"),
  };
}

/**
 * Sends the temporary credential and reports whether it left the server. Never throws and never logs the credential:
 * the Responsable still sees it on screen and hands it over manually when this returns false.
 */
export async function sendTemporaryCredentialEmail(mailer: Mailer, email: TemporaryCredentialEmail): Promise<boolean> {
  if (!mailer.configured) return false;
  try {
    await mailer.send(temporaryCredentialMessage(email));
    return true;
  } catch (error) {
    // The SMTP code and server reply (e.g. "525 5.7.1 Unauthorized IP address") explain the failure; neither carries the credential.
    const { code, responseCode, response } = (error ?? {}) as { code?: unknown; responseCode?: unknown; response?: unknown };
    console.warn("Temporary credential e-mail not sent", { employeeId: email.employee.id, code, responseCode, response });
    return false;
  }
}
