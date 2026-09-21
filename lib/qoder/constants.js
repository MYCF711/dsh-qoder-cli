/**
 * Qoder route constants shared by the Host half and the browser half.
 *
 * Every externally observable value here is either (a) quoted from the Qoder
 * bundle at `D:\Qoder\resources\app.asar.unpacked\node_modules\@qoder-ai\qoder-agent-sdk\dist\_worker\qoder-worker-runtime.obf.mjs`, or
 * (b) reproduced from a live request made during reconnaissance. Values that
 * are neither are marked UNVERIFIED and must not be presented as measured.
 *
 * Evidence ledger: docs/QODER-PROTOCOL-FINDINGS.md
 *
 * @module dsh-qoder-cli/constants
 */

/** Provider route this bundle owns in the DSH LLM registry. */
export const QODER_PROVIDER = 'qoder-cli'

/** Settings namespace owning the configuration card. */
export const QODER_SETTINGS_NS = 'qoder-cli'

/** Display name shown in provider listings and pickers. */
export const QODER_DISPLAY_NAME = 'Qoder'

/** Provider idle ceiling while one stream read is outstanding, in ms. */
export const QODER_STREAM_IDLE_TIMEOUT_MS = 3e5

/**
 * Chat-completion path.
 *
 * VERIFIED: the bundle builds this exact path —
 * `function s6e(){ return `https://${wKr()}/model/v1/chat/completions` }`
 * (offset 18965413), and a POST to it with a decrypted credential returned
 * HTTP 200 `text/event-stream`.
 */
export const QODER_CHAT_PATH = '/model/v1/chat/completions'

/**
 * Chat-completion host.
 *
 * VERIFIED: a POST to `https://api2-v2.qoder.sh/model/v1/chat/completions` with a
 * decrypted credential returned HTTP 200 `text/event-stream` and a real
 * completion.
 *
 * IMPORTANT — the bundle does NOT regionalize this host. Its host table is
 * `Sja={prod:"api2-v2.qoder.sh", daily:"daily-api2-v2.qoder.sh",
 * test:"test-api2-v2.qoder.sh"}` with no `.cn` variant, so a China-mainland
 * account still reaches the model gateway through `.qoder.sh`. The bundle's own
 * region override is the `QODER_MODEL_SERVER_HOST` environment variable, applied
 * in `wKr()`.
 *
 * A guessed `api2-v2.qoder.com.cn` was tried during reconnaissance and did not
 * answer. It is therefore NOT used as a fallback: silently failing over to a
 * host that does not exist would turn a clear error into a hang.
 */
export const QODER_CHAT_HOST = 'api2-v2.qoder.sh'

/**
 * Env var that overrides the model-gateway host, matching the bundle's `wKr()`.
 * When set, its value replaces {@link QODER_CHAT_HOST}.
 */
export const QODER_MODEL_HOST_ENV = 'QODER_MODEL_SERVER_HOST'

/** OpenAPI base per region. VERIFIED against the app's own request log. */
export const QODER_OPENAPI_BASES = {
  global: 'https://openapi.qoder.sh',
  cn: 'https://openapi.qoder.com.cn',
}

/** Region key used when discovery cannot determine one. */
export const QODER_DEFAULT_REGION = 'global'

/**
 * Windows user-data directory names Electron uses for the Qoder desktop app.
 *
 * VERIFIED: `C:\Users\<user>\AppData\Roaming\com.qoder.app.stable`
 * exists and holds `auth.v1.dat` (405 B), `Local State`, and `auth.machine-id`.
 * The `product.json` key `dataDirectoryName` is `com.qoder.app.stable`.
 */
export const QODER_USER_DATA_DIRNAME = 'com.qoder.app.stable'

/** Credential file name inside the Qoder user-data directory. */
export const QODER_CREDENTIAL_FILENAME = 'auth.v1.dat'

/** Electron local-state file holding the DPAPI-wrapped AES key. */
export const QODER_LOCAL_STATE_FILENAME = 'Local State'

/** File holding the plaintext machine id. */
export const QODER_MACHINE_ID_FILENAME = 'auth.machine-id'

/** Browser-half status endpoint. */
export const QODER_STATUS_PATH = '/plugins/dsh-qoder-cli/status'

/** Browser-half write endpoint for the enabled-model allowlist. */
export const QODER_MODELS_PATH = '/plugins/dsh-qoder-cli/enabled-models'

/** Browser-half read endpoint returning the anonymized catalog dump for opt-in sharing. */
export const QODER_CATALOG_DUMP_PATH = '/plugins/dsh-qoder-cli/catalog-dump'

/** Browser-half write endpoint for per-model context/thinking overrides. */
export const QODER_MODEL_OPTIONS_PATH = '/plugins/dsh-qoder-cli/model-options'

/** File the Host writes so `dsh-qoder-cli status` can prove the process is alive. */
export const QODER_HOST_HEARTBEAT_FILENAME = '.qoder-cli-host-heartbeat.json'

/** File the plugin owns for its refreshed credential copy. */
export const QODER_AUTH_FILENAME = '.qoder-cli-auth.json'

/** Env var that overrides credential discovery with an explicit path. */
export const QODER_AUTH_FILE_ENV = 'QODER_CLI_AUTH_FILE'

/** Reported when the Qoder desktop/cli version cannot be resolved. */
export const QODER_UNKNOWN_VERSION = 'unknown'

/** No per-token pricing is knowable for a subscription quota; report zero. */
export const NO_COST = Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

/** Image-request budgets at the dsh-llm-pi-ai defaults. */
export const REQUEST_IMAGE_BUDGETS = Object.freeze({
  maxRequestImageBytes: 20971520,
  requestImagePixelBudget: 4194304,
  requestImageMaxBytes: 1048576,
})

/** Separator between a model's display name and any appended suffix. */
export const RATE_SEPARATOR = ' \u00b7 '

/**
 * Device login flow constants.
 *
 * VERIFIED against the Qoder desktop bundle (`D:\DSH\tmp\qoder-main-index.js`):
 * - `authClientIds:{prod:"732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",…}` (bundle constant)
 * - `Ive()`: `new URL("/device/selectAccounts", t.authBaseUrl)` with
 *   `challenge/challenge_method/nonce/machine_id/client_id` query params,
 *   `authBaseUrl = https://qoder.com` (environments.prod)
 * - `uve()`: `new URL("/api/v1/deviceToken/poll", t.openApiBaseUrl)` with
 *   `nonce/verifier/challenge_method=S256`; HTTP 404 = keep polling; success
 *   body needs `token` (string) + `refresh_token` (string); deadline 300s
 *   (`ave=300*1e3`), poll interval 1s (`BV=1e3`), max 5 consecutive failures
 * - `fetchUser()`: `GET /api/v1/userinfo` with `Authorization: Bearer <token>`
 */

/** OAuth client id the desktop app presents for the device flow. */
export const QODER_AUTH_CLIENT_ID = '732aef47-9cf2-46a2-95fe-4cebb5d0d1fa'

/** Login page path on the auth base (qoder.com). */
export const QODER_SELECT_ACCOUNTS_PATH = '/device/selectAccounts'

/** Token polling path on the OpenAPI base (openapi.qoder.sh). */
export const QODER_DEVICE_POLL_PATH = '/api/v1/deviceToken/poll'

/** Account document path on the OpenAPI base. */
export const QODER_USERINFO_PATH = '/api/v1/userinfo'

/** Verifier alphabet the app's `Eve()` samples (RFC 7636 unreserved set). */
export const QODER_VERIFIER_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/** Verifier length the app generates (64 bytes → 64 chars). */
export const QODER_VERIFIER_LENGTH = 64

/** Overall device-flow deadline in ms (bundle: `ave = 300 * 1e3`). */
export const QODER_POLL_DEADLINE_MS = 300 * 1000

/** Poll interval in ms (bundle: `BV = 1e3`). */
export const QODER_POLL_INTERVAL_MS = 1000

/** Per-request ceiling in ms (bundle: `eve = 3e4`). */
export const QODER_POLL_ENDPOINT_TIMEOUT_MS = 30 * 1000

/** Browser-half route: POST → begin one device-login attempt. */
export const QODER_AUTH_START_PATH = '/plugins/dsh-qoder-cli/auth/start'

/** Browser-half route: GET → poll the running attempt. */
export const QODER_AUTH_POLL_PATH = '/plugins/dsh-qoder-cli/auth/poll'

/** Browser-half route: GET → list all discovered accounts (read-only). */
export const QODER_ACCOUNTS_LIST_PATH = '/plugins/dsh-qoder-cli/accounts'

/** Browser-half route: POST → activate a specific account. */
export const QODER_ACCOUNTS_ACTIVATE_PATH = '/plugins/dsh-qoder-cli/accounts/activate'

/** Browser-half route: POST → probe a specific account's availability. */
export const QODER_ACCOUNTS_PROBE_PATH = '/plugins/dsh-qoder-cli/accounts/probe'
