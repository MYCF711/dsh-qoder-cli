/**
 * DSH CodeBuddy-style Qoder connector — Host half.
 *
 * Registers a `qoder-cli` provider into the Harness LLM seam so Qoder's models
 * become selectable in DSH. The Qoder login is reused from the Qoder desktop
 * app's own credential store; this plugin starts no login flow of its own and
 * never writes to Qoder's files.
 *
 * The route is `openai-completions` against a loopback shim, because the Qoder
 * gateway needs per-request `Cosy-*` headers that pi-ai's provider descriptor
 * cannot express. See `lib/qoder/shim.js`.
 *
 * Assembly mirrors `dsh-codebuddy-cli` (MIT) so the two connectors behave the
 * same way; the Qoder-specific parts are the credential decryption, the gateway
 * protocol, and the built-in catalog.
 *
 * @module dsh-qoder-cli
 */

import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createProvider } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'

import {
  NO_COST,
  QODER_AUTH_FILENAME,
  QODER_DEFAULT_REGION,
  QODER_DISPLAY_NAME,
  QODER_HOST_HEARTBEAT_FILENAME,
  QODER_PROVIDER,
  QODER_SETTINGS_NS,
  QODER_STREAM_IDLE_TIMEOUT_MS,
  REQUEST_IMAGE_BUDGETS,
} from './qoder/constants.js'
import { discoverCredential, qoderOwnAuthPath } from './qoder/credentials.js'
import { qoderConfigHome } from './qoder/catalog-reader.js'
import { createDeviceLoginRegistry } from './qoder/web.js'
import { FALLBACK_QODER_MODELS, buildCatalog, filterEnabledModels, toPiModel } from './qoder/models.js'
import { loadGateCache, saveGateCache, probeCatalog, resolveProbeToken } from './qoder/gate-cache.js'
import { dpapiUnprotect } from './qoder/native.js'
import { QoderUpstreamClient } from './qoder/relay.js'
import { createQoderShim } from './qoder/shim.js'
import { QoderCredentialStore } from './qoder/store.js'
import { registerQoderRoutes } from './qoder/web.js'

/** Stable Cordis plugin name. */
export const name = 'llm-qoder-cli'

/** The model registry must exist before the provider can register. */
export const inject = ['llm']

/** Settings namespace owning the configuration card. */
export const QODER_SETTINGS_NS_EXPORT = QODER_SETTINGS_NS

export const Config = z.object({
  authFile: z.string().description(
    'Path to a plaintext Qoder credential JSON (defaults to the Qoder app\'s own encrypted store)',
  ),
  region: z.string().description('Qoder region: "global" or "cn" (defaults to global)'),
  enabledModels: z.array(z.string()).description(
    'Model ids offered in the pickers (empty means every model)',
  ),
  modelOptions: z.any().description(
    'Per-model overrides chosen on the settings card: { [modelId]: { contextLabel?, thinkingEffort? } } (context tier + thinking effort)',
  ),
})

/**
 * The plugin's catalog holder.
 *
 * The catalog cannot be fetched from Qoder (its list endpoint is unreachable
 * from this machine), so it starts as the built-in list and never becomes
 * empty. `set` exists for a future dynamic source without changing call sites.
 */
class QoderCatalog {
  #models = [...FALLBACK_QODER_MODELS]

  current() {
    return this.#models
  }

  set(models) {
    if (Array.isArray(models) && models.length > 0) this.#models = [...models]
  }
}

/**
 * Refresh the credential when it is stale.
 *
 * NOT IMPLEMENTED, deliberately and visibly. The refresh endpoint was never
 * exercised during reconnaissance — the discovered token does not expire for
 * weeks — so its URL and body are unverified for this credential type. Returning
 * the existing credential unchanged is the honest choice: guessing at a refresh
 * protocol risks overwriting a valid token with a malformed one, whereas a stale
 * token surfaces as a normal upstream 401 the user can act on by re-opening the
 * Qoder app.
 *
 * If this ever needs implementing, the evidence to gather first is: the refresh
 * URL, the exact body, and the response shape — all read from a real refresh,
 * not inferred.
 */
async function refreshCredential(credential) {
  return credential
}

/**
 * Start the loopback shim, register the provider, and wire the settings card.
 */
export function apply(ctx, config) {
  const catalog = new QoderCatalog()
  const client = new QoderUpstreamClient()

  const dshHome = resolveDshHome()
  const store = new QoderCredentialStore({
    ownPath: qoderOwnAuthPath(dshHome),
    discover: () =>
      discoverCredential(dpapiUnprotect, {
        ...process.env,
        ...(config.authFile !== undefined && config.authFile.length > 0
          ? { QODER_CLI_AUTH_FILE: config.authFile }
          : {}),
      }),
    refresh: refreshCredential,
  })

  const shim = createQoderShim({
    store,
    client,
    catalog: () => catalog.current(),
    logger: ctx.logger,
    failover: true,
    failoverDiscover: discoverCredential,
    failoverUnprotect: dpapiUnprotect,
  })

  let current = () => config
  const enabledModels = () => current().enabledModels
  const modelOptions = () => current().modelOptions ?? {}
  const region = () => current().region ?? QODER_DEFAULT_REGION

  const setEnabledModels = async (ids) => {
    const settings = ctx.get('settings')
    if (settings === undefined) return false
    await settings.update(QODER_SETTINGS_NS, { enabledModels: [...ids] })
    return true
  }

  /**
   * Catalog bootstrap: three-tier directory + per-account gate refinement.
   *
   * Fast path first (local cache or bundled snapshot → catalog.set so the
   * picker is never empty), then the gate probe refines in the background:
   * a fresh cache (≤24h) is applied instantly; a missing/stale one triggers
   * one gentle probe round and a re-set when it lands. Probe failures are
   * silent — the snapshot-era degraded notes remain authoritative fallback.
   */
  // Resolved ONCE and threaded to every consumer of the Qoder config directory
  // (buildCatalog's remote + local tiers, and resolveProbeToken). Re-deriving it
  // per call site would let the tiers disagree about which directory they read,
  // a split brain that presents as "one tier works, another sees nothing".
  const configHome = qoderConfigHome()
  let gateProbing = false
  const refreshCatalog = async () => {
    try {
      const gateCache = dshHome ? await loadGateCache(dshHome) : null
      const entries = await buildCatalog({ dshHome, gateCache, configHome })
      if (stopped) return
      catalog.set(entries)
      if (!gateCache && !gateProbing && entries.length > 0) {
        gateProbing = true
        void (async () => {
          try {
            const token = await resolveProbeToken(discoverCredential, dpapiUnprotect, configHome)
            if (!token || stopped) return
            const results = await probeCatalog(entries, token)
            if (stopped) return
            if (dshHome) await saveGateCache(dshHome, results).catch(() => {})
            const refined = await buildCatalog({
              dshHome,
              gateCache: { measuredAt: new Date().toISOString(), results },
              configHome,
            })
            if (!stopped) catalog.set(refined)
          } catch {
            // probe is best-effort; snapshot-era notes stay
          } finally {
            gateProbing = false
          }
        })()
      }
    } catch {
      // never disable the provider over catalog trouble
    }
  }
  void refreshCatalog()

  const setModelOptions = async (id, options) => {
    const settings = ctx.get('settings')
    if (settings === undefined) return false
    const next = { ...(current().modelOptions ?? {}) }
    next[id] = { ...(next[id] ?? {}), ...options }
    await settings.update(QODER_SETTINGS_NS, { modelOptions: next })
    return true
  }

  const deviceLogin = createDeviceLoginRegistry({
    store,
    // Best effort only: login works without it (a random machine id is sent).
    resolveMachineId: () =>
      store
        .resolve()
        .then((resolved) => resolved.machineId ?? null)
        .catch(() => null),
  })

  ctx.inject(['webServer'], (webCtx) => {
    registerQoderRoutes(webCtx, {
      store,
      catalogDump: async () => {
        const gateCache = dshHome ? await loadGateCache(dshHome) : null
        return buildCatalog({ dshHome, gateCache, configHome })
      },
      deviceLogin,
      models: () => catalog.current(),
      enabledModels,
      setEnabledModels,
      modelOptions,
      setModelOptions,
      settingsWritable: () => ctx.get('settings') !== undefined,
      region,
      provider: QODER_PROVIDER,
    })
  })

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, QODER_SETTINGS_NS, Config, config, {
      setSource(source) {
        current = source
      },
      onChange() {
        store.invalidate()
      },
    })
  })

  let stopped = false
  ctx.effect(() => () => {
    stopped = true
    shim.close().catch(() => {})
  })

  shim.ready
    .then(() => {
      if (stopped) return

      const buildModels = () => {
        const baseUrl = `${shim.baseUrl()}/v1`
        return catalog.current().map((info) => toPiModel(info, baseUrl, QODER_PROVIDER))
      }

      const provider = {
        ...createProvider({
          id: QODER_PROVIDER,
          name: QODER_DISPLAY_NAME,
          auth: {
            apiKey: {
              name: 'Qoder credential (resolved from the Qoder app)',
              async resolve({ credential }) {
                const apiKey = credential?.key
                return apiKey === undefined || apiKey.length === 0
                  ? undefined
                  : { auth: { apiKey }, source: 'Qoder' }
              },
            },
          },
          models: buildModels(),
          api: openAICompletionsApi(),
        }),
        getModels: () => buildModels(),
      }

      const profile = {
        provider: QODER_PROVIDER,
        displayName: QODER_DISPLAY_NAME,
        streamIdleTimeoutMs: QODER_STREAM_IDLE_TIMEOUT_MS,
        retryPolicy: resolveRetryPolicy(undefined, 'dsh-qoder-cli retryPolicy'),
        configuredMaxTokens: new Map(),
        modelErrors: new Map(),
        ...REQUEST_IMAGE_BUDGETS,
        piProvider: provider,
      }

      let invalidate
      try {
        const adapter = new QoderPiAiAdapter(catalog, enabledModels, {
          profiles: () => new Map([[QODER_PROVIDER, profile]]),
          auth: INERT_AUTH,
          resolveApiKey: async () => shim.token(),
        })
        invalidate = () => {}
        let releaseAdapter
        let releaseDirectory
        try {
          releaseAdapter = ctx.llm.registerAdapter([QODER_PROVIDER], adapter)
          releaseDirectory = ctx.llm.registerConfigurableProviders([
            {
              provider: QODER_PROVIDER,
              displayName: QODER_DISPLAY_NAME,
              settingsNs: QODER_SETTINGS_NS,
              settingsPath: [],
              declared: false,
            },
          ])
        } finally {
          if (releaseAdapter === undefined || releaseDirectory === undefined) {
            releaseAdapter?.()
            releaseDirectory?.()
          }
        }
        try {
          ctx.effect(() => () => {
            releaseAdapter?.()
            releaseDirectory?.()
          })
        } catch {
          releaseAdapter?.()
          releaseDirectory?.()
        }
      } catch (error) {
        ctx.logger.error('dsh-qoder-cli: provider registration failed', error)
        return
      }

      // Warm the credential once so a misconfiguration surfaces in the log at
      // startup rather than on the user's first message.
      void (async () => {
        try {
          await store.resolve()
          invalidate?.()
        } catch (error) {
          ctx.logger.warn(
            'dsh-qoder-cli: no usable Qoder credential yet; the provider is registered but' +
              ' requests will fail until the user signs in to Qoder',
            error,
          )
        }
      })()
    })
    .catch((error) => {
      ctx.logger.error(
        'dsh-qoder-cli: loopback shim failed to start; provider not registered',
        error,
      )
    })
}

/**
 * Inert pi-ai auth plane.
 *
 * The Qoder route authenticates only through the shim's per-process secret,
 * resolved per request by `resolveApiKey`. pi-ai's own credential lifecycle must
 * never manufacture a credential for this provider, so every ambient question
 * answers "nothing stored, nothing set".
 */
const INERT_AUTH = {
  credentials: {
    async read() {},
    async list() {
      return []
    },
    async modify() {
      throw new Error('dsh-qoder-cli: the qoder route has no pi-ai credential lifecycle')
    },
    async delete() {},
  },
  authContext: {
    async env() {},
    async fileExists() {
      return false
    },
  },
}

/**
 * `PiAiAdapter` with the enabled-model allowlist applied to the offer surface.
 *
 * Dispatch stays whole: `resolveModel` and the shim's `/v1/models` keep serving
 * the complete catalog, so a session already pinned to a model the user later
 * unchecks keeps streaming instead of failing to resolve.
 */
class QoderPiAiAdapter extends PiAiAdapter {
  #catalog
  #enabledModels

  constructor(catalog, enabledModels, options) {
    super(options)
    this.#catalog = catalog
    this.#enabledModels = enabledModels
  }

  async listModels(provider) {
    const models = await super.listModels(provider)
    const allowed = filterEnabledModels(this.#catalog.current(), this.#enabledModels?.())
    const allowedIds = new Set(allowed.map((entry) => entry.id))
    const knownIds = new Set(this.#catalog.current().map((entry) => entry.id))
    return models.filter((model) => !knownIds.has(model.id) || allowedIds.has(model.id))
  }
}

export {
  QoderCatalog,
  QODER_AUTH_FILENAME,
  QODER_HOST_HEARTBEAT_FILENAME,
  QODER_PROVIDER,
  QODER_SETTINGS_NS,
}
