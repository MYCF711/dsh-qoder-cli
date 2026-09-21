import { readLocalCatalog, readRemoteCatalog, rawModelToCatalogEntry } from './catalog-reader.js'
import { loadGateCache } from './gate-cache.js'
import { CLI_FALLBACK_MODELS, isFallbackModel } from './cli-fallback.js'

/**
 * Qoder model catalog.
 *
 * Qoder exposes no reachable model-list endpoint from this machine: the path
 * the bundle references (`/api/v2/model/list?Encode=1`) answered 404 on every
 * host tried, and the CN host answered 503. The catalog is therefore built in,
 * from keys that were each probed individually against the live gateway.
 *
 * A key is listed here ONLY if the gateway accepted it. Keys the gateway
 * answered `invalid_model_error` for are deliberately absent: offering them
 * would put a model in the picker that cannot produce a single token.
 *
 * Evidence: docs/QODER-PROTOCOL-FINDINGS.md section 4.
 *
 * @module dsh-qoder-cli/models
 */

/**
 * The built-in catalog.
 *
 * `id` is the wire key. `name` is the Qoder UI label from the app's own
 * `dynamic-text/qoder.v1.json`, except where the gateway's own routed model
 * disagrees with that label 鈥?see `routedModel`.
 *
 * Capability flags are conservative: only `text` input is declared, because no
 * image request was exercised against any Qoder model. Declaring `image` without
 * evidence would let DSH send images to a model that may reject them.
 */
export const FALLBACK_QODER_MODELS = Object.freeze([
  {
    id: 'auto',
    name: 'Auto',
    description: 'Smartly selects the optimal model, balancing performance and cost',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    /** Observed on the wire: the router answered as `qwen3-coder-plus`. */
    routedModel: 'qwen3-coder-plus',
  },
  {
    id: 'lite',
    name: 'Lite',
    description: 'Basic reasoning, free tier',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'qwen3-coder-plus',
  },
  {
    id: 'efficient',
    name: 'Efficient',
    description: 'Standard reasoning at low cost',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    /**
     * DEGRADED, measured three times in a row: the gateway recognises this key
     * (it is not `invalid_model_error`) but answers HTTP 429
     * `{"code":"provider_error","message":"All backends failed"}`. So the key is
     * valid and the failure is server-side capacity, not a wrong id.
     *
     * It stays in the catalog because dropping a valid key would hide a model the
     * provider may restore without notice, and because the failure is reported
     * honestly as a 429 rather than silently. The settings card labels it.
     */
    degraded: 'gateway reports no available backend (HTTP 429 provider_error)',
  },
  {
    id: 'performance',
    name: 'Performance',
    description: 'Advanced reasoning with high output quality',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'qwen3-coder-plus',
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    description: 'Expert-level deep reasoning and thinking with peak output quality',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
  },
  {
    id: 'dmodel',
    name: 'DeepSeek-V4-Pro',
    description: 'DeepSeek-V4-Pro-0813',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'deepseek-v4-pro',
  },
  {
    id: 'gmodel',
    name: 'GLM-5.3',
    description: 'Zhipu flagship model for complex systems engineering',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'glm-5',
  },
  {
    id: 'kmodel',
    name: 'Kimi-K2.8-Preview',
    description: 'Kimi K2.8 preview for long-context coding',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'kimi-k2.7-code',
  },
  {
    id: 'mmodel',
    name: 'MiniMax-M3',
    description: 'Native multimodal perception with 1M context',
    contextWindow: 1000000,
    maxTokens: 32768,
    input: ['text'],
    /** The gateway routed this key to MiniMax-M2.5, not M3. */
    routedModel: 'MiniMax-M2.5',
  },
  {
    id: 'qmodel',
    name: 'Qwen3.7-Plus',
    description: 'Enhanced reasoning and agentic reliability',
    contextWindow: 200000,
    maxTokens: 32768,
    input: ['text'],
    routedModel: 'qwen3.7-plus',
  },
])

/**
 * Keys the gateway answered `invalid_model_error` for.
 *
 * Exported so the exclusion is a recorded fact rather than an unexplained
 * absence: a future reader comparing this list against Qoder's UI model names
 * can see the discrepancy was measured, not overlooked.
 */
export const REJECTED_QODER_KEYS = Object.freeze([
  'dfmodel',
  'gfmodel',
  'kmodel_latest',
  'qmodel_latest',
  'qmodel_38max',
  'qmodel_38flash',
  'qfmodel',
  'smodel',
  'cmodel',
])

/**
 * Keys in `REJECTED_QODER_KEYS` that the local CLI channel CAN serve.
 *
 * The two lists answer different questions. `REJECTED_QODER_KEYS` records what
 * the REST gateway refused; the CLI set records which keys have a working
 * channel anyway. A key the gateway refuses and the CLI cannot serve is
 * genuinely degraded; a key the gateway refuses but the CLI serves is a
 * first-class model.
 *
 * `dfmodel` / `gfmodel` / `kmodel_latest` / `qmodel_latest` fall in the first
 * group: the gateway rejected them and no CLI run was ever observed to serve
 * them, so they must not be advertised as working.
 */
export const CLI_ONLY_QODER_KEYS = Object.freeze(
  REJECTED_QODER_KEYS.filter((key) => isFallbackModel(key)),
)

/**
 * Narrow a catalog by an allowlist.
 *
 * An empty allowlist means "offer everything" 鈥?matching the sibling
 * CodeBuddy connector's semantics, so a user who never opens the settings card
 * still sees the full catalog.
 */
export function filterEnabledModels(models, enabledIds) {
  if (!Array.isArray(enabledIds) || enabledIds.length === 0) return [...models]
  const allowed = new Set(enabledIds)
  return models.filter((model) => allowed.has(model.id))
}

/**
 * Build the pi-ai model descriptor for one catalog entry, pointed at `baseUrl`.
 */
export function toPiModel(info, baseUrl, provider) {
  return {
    id: info.id,
    name: info.name,
    api: 'openai-completions',
    provider,
    baseUrl,
    input: info.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
    ...(Array.isArray(info.reasoningEfforts) && info.reasoningEfforts.length > 0
      ? { reasoning: true }
      : {}),
  }
}

/**
 * Build the effective catalog: live remote catalog first, then the live local
 * cache, the bundled snapshot, and the built-in fallback last.
 *
 * Four tiers, best information first:
 *  0. remote catalog — `model/list` fetched from Qoder with a COSY-signed
 *     request (freshest possible; see readRemoteCatalog). **Currently always
 *     null in practice**: the endpoint answers 403 `Signature invalid` for
 *     every input permutation measured this sprint, so this tier degrades to
 *     tier 1. See docs/FINDING-t12-remote-tier-403.md;
 *  1. live local cache — Qoder's own catalog-v6, decrypted on this machine
 *     (only exists when a Qoder client has logged in here);
 *  2. bundled snapshot — a decrypted catalog shipped with the package
 *     (`catalog-snapshot.json`), so users without any Qoder install still see
 *     the full server directory;
 *  3. FALLBACK_QODER_MODELS — the measured minimal set, used when even the
 *     snapshot is unreadable (guards against a corrupted/missing resource).
 *
 * Every tier fails silently into the next: the provider must never be disabled
 * by an unreachable server, an unreadable cache, or a stale snapshot.
 *
 * Keys the chat gateway rejected on 2026-09-19 stay in the catalog but carry
 * a `degraded` note — the directory shows what the server offers while the
 * flag records what we measured, so neither side silently disappears.
 *
 * `configHome` is resolved ONCE by the caller and threaded to every tier, so
 * the remote reader and the local reader can never disagree about which
 * directory they are talking about (a split brain would present as "remote
 * works, local sees nothing").
 */
export async function buildCatalog(options = {}) {
  const { dshHome = null, gateCache = null, configHome = null } = options
  let raws = null
  let source = 'fallback'
  // Tier 0: remote (COSY-signed model/list). Silent null on any failure.
  try {
    const remote = await readRemoteCatalog(configHome ?? undefined)
    const SCENES = ['assistant', 'chat', 'app', 'qwake']
    if (remote && typeof remote === 'object') {
      for (const scene of SCENES) {
        if (Array.isArray(remote[scene]) && remote[scene].length > 0) {
          raws = remote[scene]
          source = 'remote'
          break
        }
      }
    }
  } catch {
    // fall through to the local cache
  }
  try {
    if (raws === null) {
      const live = configHome ? await readLocalCatalog(configHome) : await readLocalCatalog()
      const SCENES = ['assistant', 'chat', 'app', 'qwake']
      if (live && typeof live === 'object') {
        for (const scene of SCENES) {
          if (Array.isArray(live[scene]) && live[scene].length > 0) {
            raws = live[scene]
            source = 'local-cache'
            break
          }
        }
      }
    }
  } catch {
    // fall through to the snapshot
  }
  if (raws === null) {
    try {
      const snapshotUrl = new URL('./catalog-snapshot.json', import.meta.url)
      const { readFile } = await import('node:fs/promises')
      const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8'))
      const SCENES = ['assistant', 'chat', 'app', 'qwake']
      for (const scene of SCENES) {
        if (Array.isArray(snapshot[scene]) && snapshot[scene].length > 0) {
          raws = snapshot[scene]
          source = 'bundled-snapshot'
          break
        }
      }
    } catch {
      // fall through to FALLBACK
    }
  }
  if (raws === null) return [...FALLBACK_QODER_MODELS]
  const rejected = new Set(REJECTED_QODER_KEYS)
  const measured = gateCache?.results ?? null
  return raws.map((raw) => {
    const entry = rawModelToCatalogEntry(raw)
    // Models with a CLI fallback stay usable even when the REST gateway
    // rejects them: the shim transparently spawns qodercli for these keys.
    // Marking them "unavailable" would be wrong and would hide a working path.
    // The membership rule lives in cli-fallback.js so the catalog and the
    // dispatch path cannot drift apart.
    const cliCapable = isFallbackModel(entry.id)
    if (cliCapable) {
      entry.degraded = undefined
      entry.cliFallback = true
    } else if (measured && measured[entry.id]) {
      // This account's own probe round overrides the snapshot-era note.
      entry.degraded = measured[entry.id] === 'accepted' ? undefined : `not available on this account (measured ${gateCache.measuredAt})`
    } else if (rejected.has(entry.id)) {
      entry.degraded = 'not offered by chat gateway (measured 2026-09-19)'
    }
    entry.source = source
    return entry
  })
}