# Mobile and offline behavior

- Deactivation is enforced by existing authentication/session validity. No account switch can adopt an inactive employee's task or outbox.
- Known deactivation blocks local working access and synchronization per OD-01 while encrypted rows remain intact. Reauthentication as a different employee never reveals old employee rows.
- Offline saves made while authorization is valid remain in the original employee scope. A later deactivation discovered at reconnect blocks authenticated server operations; do not send under another identity.
- Pending submissions remain immutable, including their snapshot, operation ID, idempotency key, actor, correction/conflict references, and local outcome history.
- Cached task lists must not present stale work as currently assigned after the active account changes. Refresh/revoke cache using existing identity scoping; do not delete local audit data as a cache refresh side effect.
- No local device-to-device transfer, Responsable local extraction, or server sync bypass is added by this story.

## Mobile tests

- Inactive/expired identity blocks access and transport while local encrypted records and operation identifiers remain byte-for-byte intact.
- A different employee cannot read, list, retry, or export the inactive employee's local draft/outbox.
- A pending submission remains read-only and cannot be rewritten or relabeled under another employee.
- Reconnect after account deactivation yields authorization failure with safe copy and no duplicate/accepted state fabrication.
- Existing offline expiry/logout and 8.1 conflict/8.2 correction tests remain unchanged and pass.
