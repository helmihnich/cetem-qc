CREATE UNIQUE INDEX identity_accounts_email_case_insensitive_unique
  ON identity_accounts (lower(email));
