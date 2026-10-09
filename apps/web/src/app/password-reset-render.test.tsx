import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeManagement, employeeStatusLabel, requestPasswordReset } from "./employee-management";
import { ResponsableSignInForm } from "./sign-in-form";

// The web tsconfig keeps Next's `jsx: preserve`, so tsx compiles JSX with the classic runtime,
// which resolves `React` from the global scope inside the rendered components.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

test("W2 the roster offers « Réinitialiser le mot de passe » only for the active Employé", () => {
  const html = renderToStaticMarkup(<EmployeeManagement
    employees={[
      { id: "00000000-0000-4000-8000-000000000021", firstName: "Actif", surname: "Exemple", email: "actif@example.test", active: true, activated: true },
      { id: "00000000-0000-4000-8000-000000000022", firstName: "Inactif", surname: "Exemple", email: "inactif@example.test", active: false, activated: true },
    ]}
    onCreated={() => undefined}
    onRefresh={async () => undefined}
  />);
  assert.equal(html.split("Réinitialiser le mot de passe").length - 1, 1);
  const activeRow = html.slice(html.indexOf("Actif Exemple"), html.indexOf("Inactif Exemple"));
  assert.match(activeRow, /Réinitialiser le mot de passe/);
  assert.doesNotMatch(html, /Regenerer/);
});

test("W2b a technician who has not replaced the temporary password yet is shown as pending, not active", () => {
  assert.equal(employeeStatusLabel({ active: true, activated: false }), "En attente de première connexion");
  assert.equal(employeeStatusLabel({ active: true, activated: true }), "Actif");
  assert.equal(employeeStatusLabel({ active: false, activated: false }), "Inactif");
  const html = renderToStaticMarkup(<EmployeeManagement
    employees={[{ id: "00000000-0000-4000-8000-000000000023", firstName: "Nouveau", surname: "Exemple", email: "nouveau@example.test", active: true, activated: false }]}
    onCreated={() => undefined}
    onRefresh={async () => undefined}
  />);
  assert.match(html, /Nouveau Exemple<\/span>.*status-pending.*En attente de première connexion/);
});

test("W3 the Responsable sign-in form shows who to contact for a forgotten password", () => {
  const html = renderToStaticMarkup(<ResponsableSignInForm email="" password="" busy={false} onEmailChange={() => undefined} onPasswordChange={() => undefined} onSubmit={() => undefined} />);
  assert.match(html, /Mot de passe oublié \? Contactez votre administrateur\./);
  assert.match(html, /<form/);
});

const employeeId = "00000000-0000-4000-8000-000000000021";
const employee = { id: employeeId, firstName: "Actif", surname: "Exemple", email: "actif@example.test", active: true, activated: true };

function stubFetch(status: number, body: unknown, calls: Array<{ url: string; method?: string }> = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("W4 a successful reset posts to the password-reset proxy and opens the « Mot de passe réinitialisé » hand-over", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const outcome = await requestPasswordReset(employeeId, stubFetch(200, { employee, temporaryCredential: "temp-credential", emailSent: true }, calls));
  assert.deepEqual(calls, [{ url: `/api/employees/${employeeId}/password-reset`, method: "POST" }]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.credential.title, "Mot de passe réinitialisé");
  assert.match(outcome.credential.subtitle ?? "", /prochaine connexion/);
  assert.equal(outcome.credential.temporaryCredential, "temp-credential");
});

test("W5 404 and 409 show the API message and ask for a roster refresh", async () => {
  for (const [status, message] of [[404, "Technicien introuvable dans votre équipe."], [409, "Ce Technicien est désactivé. Réactivez-le avant de réinitialiser son mot de passe."]] as const) {
    const outcome = await requestPasswordReset(employeeId, stubFetch(status, { error: { code: "X", message } }));
    assert.deepEqual(outcome, { ok: false, message, stale: true });
  }
});

test("W6 other failures show the generic reset message and never a credential", async () => {
  for (const status of [401, 403, 500, 503]) {
    const outcome = await requestPasswordReset(employeeId, stubFetch(status, { error: { code: "X", message: "détail serveur" } }));
    assert.deepEqual(outcome, { ok: false, message: "Le mot de passe n’a pas pu être réinitialisé.", stale: false });
  }
  const nullBody = await requestPasswordReset(employeeId, stubFetch(404, null));
  assert.deepEqual(nullBody, { ok: false, message: "Le mot de passe n’a pas pu être réinitialisé.", stale: true });
  const offline = await requestPasswordReset(employeeId, (async () => { throw new TypeError("network"); }) as typeof fetch);
  assert.deepEqual(offline, { ok: false, message: "Le service est momentanément indisponible.", stale: false });
});
