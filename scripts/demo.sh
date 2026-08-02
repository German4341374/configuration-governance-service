#!/usr/bin/env bash
set -Eeuo pipefail

base_url="${BASE_URL:-http://127.0.0.1:8080}"
first_config='{"app":{"name":"demo-api","debug":false,"mode":"safe"},"server":{"timeoutMs":5000},"transport":{"tls":{"enabled":true}},"database":{"host":"database.internal","password":"demo-placeholder"}}'
second_config='{"app":{"name":"demo-api-v2","debug":false,"mode":"safe"},"server":{"timeoutMs":6000},"transport":{"tls":{"enabled":true}},"database":{"host":"database.internal","password":"demo-placeholder"}}'

request() {
  local actor="$1" role="$2" method="$3" path="$4" payload="${5:-}"
  if [[ -n "$payload" ]]; then
    curl --fail --silent --show-error -X "$method" "$base_url$path" \
      -H 'content-type: application/json' -H "x-actor: $actor" -H "x-role: $role" -d "$payload"
  else
    curl --fail --silent --show-error -X "$method" "$base_url$path" \
      -H "x-actor: $actor" -H "x-role: $role"
  fi
}

wait_ready() {
  for _ in {1..60}; do
    if curl --fail --silent "$base_url/health/ready" >/dev/null; then return 0; fi
    sleep 2
  done
  echo "Timed out waiting for $base_url/health/ready" >&2
  return 1
}

upload() {
  local content="$1"
  local payload
  payload="$(node -e 'const c=process.argv[1];process.stdout.write(JSON.stringify({environment:"development",format:"json",content:c}))' "$content")"
  request author editor POST /api/revisions "$payload"
}

json_value() {
  node -e 'const path=process.argv[1].split(".");let value=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const part of path)value=value[part];process.stdout.write(String(value))' "$1"
}

wait_ready
first_response="$(upload "$first_config")"
first_id="$(printf '%s' "$first_response" | json_value revision.id)"
printf '%s' "$first_response" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));if(r.revision.redactedContent.database.password!=="***REDACTED***")process.exit(1)'
request reviewer approver POST "/api/revisions/$first_id/decisions" '{"decision":"approved","comment":"Demo review"}' >/dev/null
request release deployer POST /api/environments/development/activate "{\"revisionId\":\"$first_id\",\"expectedVersion\":0}" >/dev/null
echo "first revision created, masked, approved, and activated"

second_response="$(upload "$second_config")"
second_id="$(printf '%s' "$second_response" | json_value revision.id)"
request reviewer approver POST "/api/revisions/$second_id/decisions" '{"decision":"approved","comment":"Demo review"}' >/dev/null
request release deployer POST /api/environments/development/activate "{\"revisionId\":\"$second_id\",\"expectedVersion\":1}" >/dev/null
request reader viewer GET "/api/diff?from=$first_id&to=$second_id" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));if(r.entries.length!==2)process.exit(1)'
echo "nested diff and second activation verified"

request release deployer POST /api/environments/development/rollback "{\"revisionId\":\"$first_id\",\"expectedVersion\":2}" >/dev/null
request reader viewer GET /api/audit/verify | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));if(!r.valid||r.entries<7)process.exit(1)'
request reader viewer GET "/api/revisions/$second_id/report.md?compareTo=$first_id" > configuration-report.md
echo "rollback, audit chain, and Markdown report verified"
