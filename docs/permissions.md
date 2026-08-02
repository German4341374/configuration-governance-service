# Permission model

The service uses a small role-to-capability model and delegates authentication to infrastructure.

| Role     | Read | Upload | Approve/reject | Activate/promote/rollback |
| -------- | ---: | -----: | -------------: | ------------------------: |
| viewer   |  yes |     no |             no |                        no |
| editor   |  yes |    yes |             no |                        no |
| approver |  yes |     no |            yes |                        no |
| deployer |  yes |     no |             no |                       yes |
| admin    |  yes |    yes |            yes |                       yes |

Revision authors are forbidden from approving or rejecting their own revisions, including when they
also hold an approver or admin role. This enforces separation of duties at the business layer.

`AUTH_MODE=demo` is intended only for loopback-bound local use. Missing headers become
`demo-admin/admin`, which keeps the browser demonstration compact. The process refuses to start with
demo mode when `NODE_ENV=production`.

`AUTH_MODE=trusted_headers` requires `X-Actor` and `X-Role` on every governed API request. A production
reverse proxy must authenticate the caller, delete inbound identity headers, and write trusted values
after authentication. Direct access to the application port must be blocked. The service never treats
signed configuration manifests as user authentication.

Future production evolution should map external groups to permissions, add short-lived service
identity, and record an immutable identity-provider subject in addition to the display name.
