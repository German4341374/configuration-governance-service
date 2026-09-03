# Policy model

`policies/default.yaml` is parsed and schema-validated at startup and by the CI CLI. Rules currently
cover:

- environment-scoped required paths;
- expected primitive or container types;
- environment-scoped forbidden values;
- recursive key naming conventions;
- required production TLS;
- maximum production timeout;
- prohibited production debug flags;
- prohibited local production database hosts.

Paths use dot notation for nested objects. Arrays are validated recursively for naming, but policy
paths do not currently address array indexes. All findings use stable codes and paths. Findings with
severity `error` block approval and promotion. Upload is still allowed so reviewers can see why a
candidate failed.

The policy file is deployment-owned. Review changes like source code because weakening a rule changes
the governance boundary. A later revision could version the policy hash on every revision and add
JSON Schema, Rego, or CEL adapters.
