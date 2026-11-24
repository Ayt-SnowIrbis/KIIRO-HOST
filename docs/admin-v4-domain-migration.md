# Admin v4 — domain ownership and migration

## Architecture

One domain owns each operation. Cross-domain pages link to the owner rather than duplicate mutations.

| Domain | Owner route | Operations |
| --- | --- | --- |
| Nodes | /admin/nodes | Register, edit node capacity, configure Incus, connect/disconnect, move empty nodes, remove eligible nodes |
| Regions | /admin/regions | Create and edit regions |
| IPAM | /admin/ipam | Create pools, bind to nodes, add addresses, remove empty pools |
| Images | /admin/images | Catalog edits, new disabled Incus image creation and alias mapping |
| Plans | /admin/plans | Existing plan editing, disabled plan creation, price creation and retirement |
| Instances | /admin/instances | Provisioning, list, lifecycle, deletion on detail |
| Tasks | /admin/tasks | Task monitoring |
| Audit | /admin/audit | Audit history |

## Production safety

- This branch is not deployed.
- Do not alter PostgreSQL volumes, Redis volumes, Incus storage or TLS trust during UI migration.
- Physical node shutdown, reboot and OS maintenance remain SSH-only.
- Never manually edit reserved node capacity from the admin panel.
- Do not allow a status dropdown to impersonate Incus connectivity; connect/disconnect endpoints must enforce their backend checks.
- Keep legacy Infrastructure and Provisioning pages reachable until parity is established; legacy provisioning form must preserve routed networkMode and parent.

## Remaining work before merge

1. Verify frontend TypeScript compilation and Next.js production build in an isolated environment.
2. Verify API response shape for image metadata / incusAlias and add a regression test.
3. Complete dependency guards and billing integration tests; plan creation and price lifecycle are implemented, but destructive deletion is deliberately not exposed.
4. Complete editable domain detail cards and explicit maintenance workflow; read-only node detail card exists.
5. Remove legacy routes after functional parity and UI validation; duplicate legacy navigation entries are hidden.
6. Validate delete confirmation, RBAC, audit and anti-CSRF protection on destructive actions.
7. Check that managed instance deletion does not affect manually managed Incus containers.
8. Review node/IPAM allocation and disk quota enforcement before commercial rollout.
9. Obtain review, run CI, merge PR and deploy only after verification.

## Theme

Admin-only cold monochrome theme: near-black backgrounds, neutral graphite surfaces, subtle white borders and typography. Preserve explicit error/danger states for accessibility.
