# Concierge Care — live (Coworker headless)

Your static deck prototype, now calling CX Enterprise Coworker the same way Claude does: MCP over HTTP, tool `ask_aep_agent`.

```
sample-cja-data/*.json ─┐
(or uploaded exports)   ├─► server.mjs (127.0.0.1) ─► Coworker MCP ─► "Concierge Care Analysis Tabular" (Phase 1)
CJA CSV (optional) ─────┘          │                                         │
                                   ▼                                         ▼
              Browser UI (public/index.html + live.js) ◄────────── output/findings.json
```

## Run it

Needs Node 18+. No `npm install`. Copy this folder somewhere permanent first (for example `~/concierge-care-live`).

```bash
cd ~/concierge-care-live
node server.mjs               # then open http://localhost:8787
```

Click **Connection** (top right), paste an Adobe IMS bearer token, **Test connection**. The chip turns **LIVE · COWORKER**. Phase 1 and the investigation steps need the token. `output/findings.json` does not exist until Phase 1 has run; after that it is shown again on restart.

No Adobe access? `npm run mock` in one terminal and `npm run start:mock` in another gives canned responses.

## Phase 1: findings.json from your CJA exports

1. Put the three CJA JSON exports in **`sample-cja-data/`** (prompts, responses, feedback; any file names, they are recognised by content). Three sample exports are included. Or use **Upload CJA exports…** on the Concierge Health page.
2. Open **Concierge Health** and click **Run Phase 1**. The proxy joins prompts and responses on conversationID + turnID, redacts personal data, and sends the table to the skill `/concierge-care-analysis-tabular` with read-only instructions.
3. If the skill asks a question, it appears as a card and your reply is sent as typed.
4. The skill's `findings.json` is validated and saved to **`output/findings.json`** (the full reply goes to `output/phase1-response.md`). Use **Download findings.json** to save it.
5. The **Findings** list is drawn from that file. Each finding shows whether its conversation IDs and example questions were found in your data, and warnings if the file disagrees with your data (for example `prompt_source` or `window`).
6. **Investigate** on a finding starts Trace → Attribute → Remediate → Certify with the finding as the starting point and your data attached as evidence.

## What else is live

| UI step | Coworker call |
|---|---|
| Home prompt | **Trace** (read-only) |
| Attribute | **Attribute** (read-only) |
| Remediate | **Plan only** (no writes) |
| Approve + send | **Execute** with the exact approved text; Coworker may ask for its own approval |
| Certify | **Certify**: golden set + replay, or "could not evaluate" |
| Concierge Health → Live health check | `/concierge-care-health-check-tabular` (needs SQL execution in your org) |
| Follow-up box | Free-form turn in the same episode |

Blockers Coworker reports are shown, not hidden.

## CSV export (optional)

The **＋** button on the home page accepts a CJA CSV. It is parsed in memory, columns are auto-detected (you can correct them), and a redacted digest is appended to Trace / Attribute prompts. A CSV takes precedence over the JSON data for those stages. Limits: 5 MB, 100,000 rows.

## Tests

```bash
npm run mock &                                  # or start the mock in another terminal
OUTPUT_DIR=/tmp/care-out npm run start:mock &   # keeps your real output/ untouched
npm test                                        # unit + flow + streaming/log/cancel tests
```

## Logging and debugging

Every Coworker turn is logged: the exact message the proxy sent (`→ request`), the HTTP response timing, each progress notification Coworker streams (`⋯ progress`), and the full reply (`← response`), plus errors and cancels.

- **UI:** top right, **Debug log**. Newest first, auto-refreshes, click an entry for the full text. It also has a download link.
- **Console:** one line per entry in the terminal running `node server.mjs`.
- **File:** `logs/coworker-YYYY-MM-DD.jsonl` (private, mode 0600).
- The bearer token is never written. The log **does contain conversation text**; set `LOG_PAYLOADS=0` to log sizes only, and `LOG_DIR` to move it.

### If Phase 1 seems slow

A real Phase 1 turn takes about 70 s or more (Coworker runs several tools). The UI now shows elapsed seconds and the last thing Coworker reported, with a **Cancel** button. The proxy returns the moment Coworker's result arrives instead of waiting for the stream to close (that was the cause of "endless"). The turn timeout is 300 s; change it with `COWORKER_TIMEOUT_MS` (30000 to 900000). If it times out, the Debug log shows the last event received. Cancel also aborts the upstream call.

## Security notes

- Proxy binds to loopback only; Host and Origin are checked; POSTs need a per-process CSRF token.
- The token lives in proxy memory only. It never reaches the browser, a file or the log. Uploaded files are never written to disk. The Coworker log (`logs/`) holds the text sent and received unless `LOG_PAYLOADS=0`. Only `findings.json` and the Coworker reply are saved, in `output/`.
- Only `ask_aep_agent`, `core_list_orgs`, `core_list_sandboxes` are reachable. The endpoint must be https on `*.adobe.io` / `*.adobe.com`; redirects are refused.
- Uploads: type and extension checked, size capped, binary refused. Identity fields (ECID) are never read from the exports.
- Data is fenced in prompts as "data only"; delimiter lookalikes and code fences inside it are neutralised. Redaction is pattern-based and will not catch every name.
- Strict CSP with nonces; all Coworker and file text is HTML-escaped before display; only `https:` links are linkified. `findings.json` content is length-limited and type-checked before use.

## Known limits

- Auth is a pasted bearer token (typically ~24h). A browser sign-in flow (OAuth) is not built.
- The UI asks Coworker for JSON. If it answers in prose only, you get the prose and no findings.
- Tested against the mock Coworker, and the data handling against your three real exports. Not run against Adobe's live endpoint from my side.

`dev/fixtures/findings.sample.json` is test data only; the app never reads it.
