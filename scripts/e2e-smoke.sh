#!/usr/bin/env bash
set -euo pipefail
API="${API_URL:-http://localhost:3001/api}"

echo "Health check..."
curl -sf "$API/health" | grep -q ok

TOKEN=$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"nurse@triagepulse.local","password":"triage123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "Create journey..."
JID=$(curl -sf -X POST "$API/journeys" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"patientNameAr":"E2E Test","age":40}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "Visual triage..."
curl -sf -X POST "$API/journeys/$JID/visual-triage" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"sectionA":{"breathing":"green","consciousness":"green","bleeding":"green","skin":"green","mobility":"green"},"respiratorySymptoms":{},"monkeypoxRisk":"none","age":40}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['destination']['destination']"

echo "CTAS evaluate..."
curl -sf -X POST "$API/triage/evaluate" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"patient":{"chief_complaint":"Back Pain","age":34,"hr":78,"bp_systolic":118,"spo2":98,"rr":16,"temperature":36.8,"gcs":15,"pain_score":2}}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['ctas']['level']"

echo "Tracking board..."
COUNT=$(curl -sf "$API/tracking/board" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
echo "Active patients on board: $COUNT"

echo "E2E smoke test passed."
