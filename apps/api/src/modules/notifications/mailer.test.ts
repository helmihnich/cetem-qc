import assert from "node:assert/strict";
import test from "node:test";
import { createMailer, sendTemporaryCredentialEmail, temporaryCredentialMessage } from "./mailer.js";
import type { MailMessage, Mailer } from "./mailer.js";

const employee = { id: "00000000-0000-4000-8000-000000000001", firstName: "Nour", email: "nour@example.com" };

test("e-mail is disabled without SMTP_HOST and incomplete SMTP settings fail without leaking values", () => {
  assert.equal(createMailer({}).configured, false);
  assert.equal(createMailer({ SMTP_HOST: "  " }).configured, false);
  assert.throws(() => createMailer({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "login", SMTP_PASSWORD: "super-secret" }), (error: Error) => {
    assert.match(error.message, /MAIL_FROM/);
    assert.doesNotMatch(error.message, /super-secret|login/);
    return true;
  });
  assert.throws(() => createMailer({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "abc", SMTP_USER: "u", SMTP_PASSWORD: "p", MAIL_FROM: "a@example.com" }), /SMTP_PORT/);
  assert.equal(createMailer({ SMTP_HOST: "smtp-relay.brevo.com", SMTP_USER: "u", SMTP_PASSWORD: "p", MAIL_FROM: "a@example.com" }).configured, true);
});

test("the message carries the credential, the login address when configured, and the first-login rule", () => {
  const created = temporaryCredentialMessage({ employee, temporaryCredential: "Ab3!xYz9", reason: "created", loginUrl: "https://qc.example.com" });
  assert.equal(created.to, "nour@example.com");
  assert.equal(created.subject, "Votre accès CETEM QC");
  assert.match(created.text, /Bonjour Nour/);
  assert.match(created.text, /Mot de passe temporaire : Ab3!xYz9/);
  assert.match(created.text, /Connexion : https:\/\/qc\.example\.com/);
  assert.match(created.text, /première connexion/);
  const reset = temporaryCredentialMessage({ employee, temporaryCredential: "Ab3!xYz9", reason: "reset" });
  assert.match(reset.subject, /nouveau mot de passe temporaire/);
  assert.doesNotMatch(reset.text, /Connexion :/);
});

test("sending reports the outcome and never throws or logs the credential", async () => {
  const sent: MailMessage[] = [];
  const working: Mailer = { configured: true, send: async (message) => { sent.push(message); } };
  assert.equal(await sendTemporaryCredentialEmail(working, { employee, temporaryCredential: "Ab3!xYz9", reason: "created" }), true);
  assert.equal(sent.length, 1);

  const failing: Mailer = { configured: true, send: async () => { throw new Error("SMTP down"); } };
  const logged: unknown[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { logged.push(...args); };
  try {
    assert.equal(await sendTemporaryCredentialEmail(failing, { employee, temporaryCredential: "Ab3!xYz9", reason: "reset" }), false);
  } finally { console.warn = original; }
  assert.doesNotMatch(JSON.stringify(logged), /Ab3!xYz9/);

  assert.equal(await sendTemporaryCredentialEmail(createMailer({}), { employee, temporaryCredential: "Ab3!xYz9", reason: "created" }), false);
});
