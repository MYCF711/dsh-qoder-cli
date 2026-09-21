/**
 * CLI-subprocess fallback for models the REST gateway rejects.
 *
 * Measured: `qfmodel` (Qwen3.8-Flash) answers `400 invalid_model_error` on the
 * OpenAI-compatible endpoint but works through the Qoder CLI's private
 * `agent_chat_generation` path. The CLI binary exposes a print mode:
 *
 * ```
 * qodercli -p --no-session-persistence --dangerously-skip-permissions \
 *   -m <model> --context-window <ctx> -o stream-json "<prompt>"
 * ```
 *
 * `-o stream-json` is load-bearing: the CLI emits one JSON event per line and
 * runs its OWN tool loop inside the single print-mode invocation (measured:
 * `tool_use` -> `tool_result` -> final `text`, `num_turns: 2`). This module
 * translates those events into an OpenAI SSE body. Tool activity is surfaced as
 * a plain-text progress note, NOT as an OpenAI `tool_calls` frame — see the
 * note on `segmentsFromEvents` for why emitting one would deadlock the caller.
 * Plain (non-JSON) output still degrades to a single text delta.
 *
 * Safety: the CLI path comes from `QODER_CLI_PATH` or the well-known install
 * location; a missing binary or a spawn refusal disables the fallback and the
 * original REST error is surfaced unchanged.
 *
 * @module dsh-qoder-cli/cli-fallback
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Model keys eligible for the CLI fallback (measured REST rejections).
 *
 * Membership rule, not a hand-kept wish list: a key belongs here when the REST
 * gateway rejected it with `invalid_model_error` but the CLI serves it. Measured
 * against `https://api2-v2.qoder.sh/model/v1/chat/completions` on the same
 * credential:
 *
 *   400 invalid_model_error : qmodel_38max, qmodel_38flash, qfmodel, smodel, cmodel
 *   200 (served)            : auto, ultimate, performance, qmodel, kmodel,
 *                             gmodel, dmodel, mmodel
 *
 * The 200 set must NOT appear here: routing a healthy REST model through a
 * subprocess would trade a working path for a slower, more fragile one. The
 * `REJECTED_QODER_KEYS` list in `models.js` is the same fact seen from the
 * catalog side, and a test asserts the two stay in sync.
 */
export const CLI_FALLBACK_MODELS = Object.freeze(
  new Set(['qmodel_38max', 'qmodel_38flash', 'qfmodel', 'smodel', 'cmodel']),
)

/**
 * Membership test for the CLI channel — the single source of truth.
 *
 * Use this rather than reaching into the set, so a future membership rule (a
 * catalog flag, a per-account allowlist) has exactly one home. A `Set.has` call
 * is prototype-safe, which matters because the model id arrives from a request.
 *
 * @param {unknown} model
 * @returns {boolean}
 */
export function isFallbackModel(model) {
  return typeof model === 'string' && CLI_FALLBACK_MODELS.has(model)
}

/**
 * Stable reason codes for every way the CLI channel can fail to produce an
 * answer.
 *
 * These exist so "the CLI channel did not answer" is never collapsed into "the
 * model answered nothing". The caller can log or surface the reason, and a test
 * can assert that no failure path invents a code.
 */
export const CLI_FAILURE_REASONS = Object.freeze(
  new Set([
    /** No `QODER_CLI_PATH` and no well-known install exists. */
    'cli-not-found',
    /** `QODER_CLI_PATH` was set but names a file that is not there. */
    'missing-cli-path',
    /** The request carried no user message to send. */
    'no-prompt',
    /** The CLI exists but the runtime refused to start it (sandbox EPERM). */
    'spawn-unavailable',
    /** The CLI exited with a nonzero status. */
    'nonzero-exit',
    /** The CLI exited 0 but printed nothing. */
    'empty-output',
    /** The runtime terminated the child (measured: exit code 0xC000013A). */
    'killed',
    /** The run exceeded its ceiling. */
    'timeout',
    /** The caller aborted the run. */
    'aborted',
    /** Any other failure, carrying its own message. */
    'error',
  ]),
)

/** Hard ceiling for one CLI run. */
export const CLI_TIMEOUT_MS = 120_000

/**
 * Exit code Windows reports when a console process is terminated by the runtime
 * rather than by its own logic.
 *
 * `0xC0000142` is `STATUS_DLL_INIT_FAILED`. Measured on this machine: a sandboxed
 * agent is handed a real pid and then every child is terminated ~10-50ms later
 * with this code and a `null` signal, whether it is `node.exe`, `cmd.exe`, or
 * `qodercli.exe`. The value is established by measurement, not by reading a
 * header — so it is named here and pinned by a test rather than trusted to the
 * label.
 *
 * Classifying it separately from an ordinary nonzero exit is what keeps "the
 * runtime killed it" distinct from "the CLI said no".
 */
const KILLED_EXIT_CODE = 3221225794 // 0xC0000142

/** Well-known install locations, probed in order when the env var is unset. */
export const CLI_CANDIDATE_PATHS = Object.freeze([
  // The official CLI install. `qodercli.exe` there is a 0-byte shim sitting
  // next to the real versioned binary, so the versioned name is probed first.
  String.raw`C:\Users\Administrator\.qoder\bin\qodercli\qodercli-1.1.58.exe`,
  String.raw`C:\Users\Administrator\.qoder\bin\qodercli\qodercli.exe`,
  // A full copy kept outside the profile, so a profile-local install problem
  // cannot take the channel away entirely.
  String.raw`D:\QoderCLI\qodercli.exe`,
])

/**
 * Resolve the CLI executable plus the reason it could not be resolved.
 *
 * An explicit `QODER_CLI_PATH` is authoritative: when it is set but does not
 * exist, resolution FAILS rather than falling through to some other binary. The
 * operator named a program; silently running a different one would make this
 * channel's behaviour depend on an unrelated install.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{path: string|null, reason: string|null, source: 'env'|'probe'|null}}
 */
export function resolveCli({ env = process.env } = {}) {
  const override = typeof env.QODER_CLI_PATH === 'string' ? env.QODER_CLI_PATH.trim() : ''
  if (override.length > 0) {
    try {
      if (existsSync(override)) return { path: override, reason: null, source: 'env' }
    } catch {
      // An unreadable override is still an override that failed, not a hint to
      // go looking elsewhere.
    }
    return { path: null, reason: 'missing-cli-path', source: 'env' }
  }
  for (const path of CLI_CANDIDATE_PATHS) {
    try {
      if (existsSync(path)) return { path, reason: null, source: 'probe' }
    } catch {
      // An unreadable candidate is skipped, not fatal.
    }
  }
  return { path: null, reason: 'cli-not-found', source: null }
}

/**
 * Resolve the CLI executable path.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {string|null} absolute path when the binary exists, else null.
 */
export function resolveCliPath(options = {}) {
  return resolveCli(options).path
}

/**
 * Extract the last user message text from an OpenAI chat body.
 *
 * @param {object} body  Parsed request body (`{model, messages}`).
 * @returns {string} the prompt, or an empty string when none is present.
 */
export function promptFromBody(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role === 'user') {
      const content = message.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        return content
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .join('\n')
          .trim()
      }
    }
  }
  return ''
}

/**
 * Translate one stream-json event into an ordered list of answer segments.
 *
 * Segments are either `{kind:'progress', text}` (a non-structured note about
 * tool activity) or `{kind:'text', text}` (model prose).
 *
 * Why `tool_use` is NOT mapped to OpenAI `tool_calls`: measured on a real run
 * (`t9-oracle-tool.txt`), the CLI executes its own tool loop inside the single
 * `-p` invocation (`tool_use` -> tool runs -> `tool_result` -> final `text`,
 * `num_turns: 2`). A `tool_calls` frame is an instruction the harness ACTS ON;
 * emitting one would make the harness execute the call and wait for a result
 * that no live process can ever return, because the `-p` run has already
 * exited.
 *
 * Why only the tool NAME is carried: `block.input` holds the arguments (a shell
 * command line, file paths). That text is executable content and must not be
 * republished into an answer body where a downstream consumer could read it as
 * an instruction. The name alone satisfies "the process was visible".
 *
 * Repeated tools are collapsed into ONE line (`[qoder-cli: ran Bash, Read]`) so
 * a tool-heavy turn cannot flood the answer.
 */
function segmentsFromEvents(events) {
  const segments = []
  const ranNames = []
  for (const event of events) {
    if (event.type !== 'assistant') continue
    const content = event.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === 'text') {
        const text = typeof block.text === 'string' ? block.text : ''
        if (text.length > 0) segments.push({ kind: 'text', text })
        continue
      }
      if (block.type === 'tool_use') {
        const name = typeof block.name === 'string' && block.name.length > 0 ? block.name : 'unknown'
        if (!ranNames.includes(name)) ranNames.push(name)
      }
      // `thinking` and `tool_result` are not answer content: the latter is the
      // CLI's own tool output and echoing it back invites a duplicate run.
    }
  }
  if (ranNames.length > 0) segments.unshift({ kind: 'progress', text: `[qoder-cli: ran ${ranNames.join(', ')}]` })
  return segments
}

/** Parse line-delimited `-o stream-json` output; null when it is not JSON. */
function parseStreamJsonEvents(raw) {
  const events = []
  let sawJson = false
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    sawJson = true
    if (parsed !== null && typeof parsed === 'object') events.push(parsed)
  }
  return sawJson ? events : null
}

/** Segments for any CLI output shape (stream-json events or a plain answer). */
function segmentsFromCliOutput(raw) {
  const events = parseStreamJsonEvents(raw)
  if (events === null) {
    const text = String(raw).trim()
    return text.length > 0 ? [{ kind: 'text', text }] : []
  }
  return segmentsFromEvents(events)
}

/**
 * Build an OpenAI SSE body from the CLI's output.
 *
 * `text` is the CLI's raw stdout. When it is a `-o stream-json` event stream,
 * progress notes and prose are assembled into content deltas; otherwise the
 * value is treated as a plain answer and emitted as one delta. The stream
 * always ends with `finish_reason: 'stop'` and `[DONE]` so the caller resolves
 * the turn instead of waiting.
 *
 * @param {string} model  Model id as requested by the caller.
 * @param {string} text   The CLI's full raw output.
 * @returns {string} a complete `data:` stream including `[DONE]`.
 */
export function wrapAsSse(model, text) {
  const id = `chatcmpl-qoder-cli-${Date.now().toString(36)}`
  const created = Math.floor(Date.now() / 1000)
  const frame = (delta, finishReason = null) => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })

  const segments = segmentsFromCliOutput(text)
  // Progress notes lead, then the model's prose — one readable answer body.
  const body = [
    ...segments.filter((s) => s.kind === 'progress').map((s) => s.text),
    ...segments.filter((s) => s.kind === 'text').map((s) => s.text),
  ].join('\n\n')

  const parts = [
    `data: ${JSON.stringify(frame({ role: 'assistant', content: body }))}\n\n`,
    `data: ${JSON.stringify(frame({}, 'stop'))}\n\n`,
    'data: [DONE]\n\n',
  ]
  return parts.join('')
}

/**
 * Decide whether a failed REST attempt is eligible for the CLI fallback.
 *
 * @param {string|null} model  Requested model id.
 * @param {{kind?: string, status?: number, message?: string}} failure  Relay failure.
 * @returns {boolean}
 */
export function isCliFallbackEligible(model, failure) {
  if (typeof model !== 'string') return false
  if (!isFallbackModel(model)) return false
  if (!failure) return false
  // The gateway refuses a proprietary key in four measured shapes:
  //   1. HTTP 400 invalid_model_error      -> http_error, status 400
  //   2. in-band 200 frame                 -> http_error, status 200,
  //      message contains Unsupported model / invalid_model_error
  //   3. HTTP 500 internal server error    -> server_error, status 502
  //   4. HTTP 429 provider_error           -> rate_limit
  // All mean the REST path will not serve this key; the CLI can. Case-insensitive
  // on the message because the capitalisation varies between shapes.
  if (failure.kind === 'server_error' || failure.kind === 'rate_limit') return true
  if (failure.kind !== 'http_error') return false
  if (failure.status === 400 || failure.status === 200) return true
  const message = (failure.message ?? '').toLowerCase()
  return message.includes('invalid_model_error') || message.includes('unsupported model')
}

/** Classify a finished-but-unsuccessful CLI run into a stable reason code. */
function classifyRunFailure(code, text, errText) {
  const detail = errText.length > 0 ? errText.slice(0, 400) : 'no diagnostic on stderr'
  if (code === KILLED_EXIT_CODE) {
    // `code` is unsigned; `>>> 0` renders the 0xC0000000-range value Windows
    // actually uses, instead of a sign-extended 64-bit hex string.
    const hex = `0x${(code >>> 0).toString(16).toUpperCase()}`
    return {
      reason: 'killed',
      message: `qoder CLI was terminated by the runtime (exit code ${hex}, STATUS_DLL_INIT_FAILED): ${detail}`,
    }
  }
  if (code !== 0) {
    return { reason: 'nonzero-exit', message: `qoder CLI exited ${code}: ${detail}` }
  }
  return { reason: 'empty-output', message: 'qoder CLI exited 0 but produced no output' }
}

/**
 * Run the CLI once and collect stdout.
 *
 * Primary path: `spawn` with piped stdio. Some sandboxed runtimes (measured:
 * the DSH development harness) refuse piped-child stdio with EPERM while
 * still allowing the process itself to start; the shell-redirect path covers
 * exactly that case by routing output through files instead of pipes.
 *
 * @param {object} options
 * @param {string} options.cliPath      Absolute path to the CLI executable.
 * @param {string} options.model        Model id passed to `-m`.
 * @param {number} [options.contextWindow]  Value for `--context-window`.
 * @param {string} options.prompt       Full prompt text.
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.spawnImpl]  Injectable spawn for tests.
 * @returns {Promise<{ok: true, text: string} | {ok: false, reason: string, message: string}>}
 */
export async function runCliCompletion({
  cliPath,
  model,
  contextWindow = 1_000_000,
  prompt,
  timeoutMs = CLI_TIMEOUT_MS,
  signal,
  spawnImpl = spawn,
}) {
  const piped = await runCliPiped({ cliPath, model, contextWindow, prompt, timeoutMs, signal, spawnImpl })
  if (piped.ok) return piped
  // Only the two proven spawn-refusal shapes escalate to the shell path. A
  // nonzero exit or a sandbox kill is a real result, not a transport problem,
  // and re-running the CLI after either would double-charge the user.
  const refused = piped.reason === 'spawn-unavailable' || piped.reason === 'error'
  if (!refused) return piped
  // Windows-only shell fallback: cmd.exe would carry the redirect while the
  // child's stdio stays 'ignore'. Kept because it is the correct shape for a
  // runtime that refuses only PIPED child stdio — see probeCliShellRedirect.
  if (process.platform !== 'win32') return piped
  const shell = await runCliShellRedirect({ cliPath, model, contextWindow, prompt, timeoutMs, signal })
  if (shell.ok) return shell
  // Both shapes refused: prefer the more specific diagnostic, so a caller can
  // tell "pipes are refused" from "this runtime refuses every child process".
  return shell.reason === 'spawn-unavailable' ? shell : piped
}

/**
 * Build the CLI argv for one print-mode run.
 *
 * Single source of truth: the piped and shell-redirect paths must send byte-
 * identical arguments, otherwise one of them silently loses the tool channel.
 *
 * @param {string} model
 * @param {number} contextWindow
 * @param {string} prompt
 * @returns {string[]}
 */
function cliArgs({ model, contextWindow, prompt }) {
  return [
    '-p',
    '--no-session-persistence',
    '--dangerously-skip-permissions',
    '-m', model,
    '--context-window', String(contextWindow),
    // stream-json makes the CLI emit tool_use events instead of flattening the
    // whole turn into text. Without it the model's tool calls are discarded and
    // an agent consumer sees a plain Q&A turn.
    '-o', 'stream-json',
    prompt,
  ]
}

/** Piped-stdio attempt (the normal path in an unsandboxed host). */
function runCliPiped({ cliPath, model, contextWindow, prompt, timeoutMs, signal, spawnImpl }) {
  return new Promise((resolve) => {
    let workDir
    const cleanup = async () => {
      if (workDir !== undefined) await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
    mkdtemp(join(tmpdir(), 'qoder-cli-fallback-'))
      .then((dir) => {
        workDir = dir
        const args = cliArgs({ model, contextWindow, prompt })
        let child
        try {
          child = spawnImpl(cliPath, args, { cwd: dir, windowsHide: true })
        } catch (error) {
          return resolve({ ok: false, reason: 'spawn-unavailable', message: `qoder CLI spawn failed: ${error?.message ?? error}` })
        }
        const stdout = []
        const stderr = []
        let settled = false
        const finish = async (result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener?.('abort', onAbort)
          child.removeAllListeners?.('error')
          child.stdout?.removeAllListeners?.('data')
          child.stderr?.removeAllListeners?.('data')
          try { child.kill?.() } catch {}
          await cleanup()
          resolve(result)
        }
        const timer = setTimeout(() => void finish({ ok: false, reason: 'timeout', message: `qoder CLI timed out after ${timeoutMs}ms` }), timeoutMs)
        const onAbort = () => void finish({ ok: false, reason: 'aborted', message: 'qoder CLI run aborted' })
        signal?.addEventListener?.('abort', onAbort, { once: true })
        child.on('error', (error) => {
          // Spawn refusals (sandbox EPERM) land here, not in the throw above.
          const detail = String(error?.message ?? error)
          const hint = /EPERM/i.test(detail)
            ? ' (EPERM: this runtime refuses to start child processes for the agent; the CLI channel needs a host that permits it)'
            : ''
          void finish({ ok: false, reason: 'spawn-unavailable', message: `qoder CLI spawn failed: ${detail}${hint}` })
        })
        child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
        child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
        child.on('close', (code) => {
          const text = Buffer.concat(stdout).toString('utf8').trim()
          if (code === 0 && text.length > 0) {
            return void finish({ ok: true, text })
          }
          const errText = Buffer.concat(stderr).toString('utf8').trim()
          void finish({ ok: false, ...classifyRunFailure(code, text, errText) })
        })
      })
      .catch((error) => {
        void cleanup()
        resolve({ ok: false, reason: 'error', message: `qoder CLI workdir failed: ${error?.message ?? error}` })
      })
  })
}

/**
 * Shell-redirect attempt for runtimes that refuse piped-child stdio (EPERM).
 * `cmd.exe /c` owns the redirection, so the CLI's stdio is 'ignore' — the
 * spawn shape such runtimes permit. Output is collected from files.
 */
function runCliShellRedirect({ cliPath, model, contextWindow, prompt, timeoutMs, signal }) {
  return new Promise((resolve) => {
    let workDir
    const cleanup = async () => {
      if (workDir !== undefined) await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
    mkdtemp(join(tmpdir(), 'qoder-cli-fallback-'))
      .then(async (dir) => {
        workDir = dir
        const outFile = join(dir, 'stdout.txt')
        const errFile = join(dir, 'stderr.txt')
        const args = cliArgs({ model, contextWindow, prompt })
        // Quote every argument; the prompt travels as one cmd argument.
        const quoted = args.map((arg) => `"${String(arg).replace(/"/g, '""')}"`).join(' ')
        const commandLine = `"${cliPath}" ${quoted} > "${outFile}" 2> "${errFile}"`
        let child
        try {
          child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', commandLine], {
            cwd: dir,
            windowsHide: true,
            stdio: 'ignore',
          })
        } catch (error) {
          await cleanup()
          return resolve({ ok: false, reason: 'spawn-unavailable', message: `qoder CLI shell spawn failed: ${error?.message ?? error}` })
        }
        let settled = false
        const finish = async (result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener?.('abort', onAbort)
          child.removeAllListeners?.('error')
          try { child.kill?.() } catch {}
          resolve(result)
        }
        const timer = setTimeout(() => void finish({ ok: false, reason: 'timeout', message: `qoder CLI timed out after ${timeoutMs}ms` }), timeoutMs)
        const onAbort = () => void finish({ ok: false, reason: 'aborted', message: 'qoder CLI run aborted' })
        signal?.addEventListener?.('abort', onAbort, { once: true })
        child.on('error', (error) => {
          void finish({ ok: false, reason: 'spawn-unavailable', message: `qoder CLI shell spawn failed: ${error?.message ?? error}` })
        })
        child.on('close', async (code) => {
          try {
            const text = await readFile(outFile, 'utf8').then((s) => s.trim()).catch(() => '')
            const errText = await readFile(errFile, 'utf8').then((s) => s.trim()).catch(() => '')
            await cleanup()
            if (code === 0 && text.length > 0) {
              return void finish({ ok: true, text })
            }
            // No output file at all means the redirect never ran, which points
            // at the runtime refusing the shell too, not at the CLI.
            const failure = classifyRunFailure(code, text, errText)
            if (failure.reason === 'empty-output') {
              return void finish({
                ok: false,
                reason: 'spawn-unavailable',
                message: 'qoder CLI shell redirect produced no output file; the runtime likely refused cmd.exe as well',
              })
            }
            void finish({ ok: false, ...failure })
          } catch (error) {
            await cleanup()
            void finish({ ok: false, reason: 'error', message: `qoder CLI output read failed: ${error?.message ?? error}` })
          }
        })
      })
      .catch((error) => {
        void cleanup()
        resolve({ ok: false, reason: 'error', message: `qoder CLI workdir failed: ${error?.message ?? error}` })
      })
  })
}

/**
 * Probe whether the CLI channel can actually run on THIS host.
 *
 * Exists because "the module is wired correctly" and "the channel works here"
 * are different claims, and conflating them is how a dead channel passes a test
 * suite. Returns machine-readable evidence rather than a boolean so a caller can
 * report what was tried. Never throws.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{cliPath: string|null, source: string|null, reachable: boolean, reason: string|null, detail: string, stdoutHead: string}>}
 */
export async function probeCliChannel({ env = process.env, timeoutMs = 30_000 } = {}) {
  const resolved = resolveCli({ env })
  if (resolved.path === null) {
    return {
      cliPath: null,
      source: resolved.source,
      reachable: false,
      reason: resolved.reason,
      detail: `qoder CLI not resolved: ${resolved.reason}`,
      stdoutHead: '',
    }
  }
  const run = await runCliCompletion({
    cliPath: resolved.path,
    model: 'qmodel_38max',
    prompt: 'Reply with exactly: PONG',
    timeoutMs,
  })
  if (run.ok) {
    return {
      cliPath: resolved.path,
      source: resolved.source,
      reachable: true,
      reason: null,
      detail: 'qoder CLI answered',
      stdoutHead: run.text.slice(0, 200),
    }
  }
  return {
    cliPath: resolved.path,
    source: resolved.source,
    reachable: false,
    reason: run.reason,
    detail: run.message,
    stdoutHead: '',
  }
}

/**
 * Full fallback: when eligible, run the CLI and shape the answer as an OpenAI
 * SSE body. Never throws — any failure returns a descriptive error result the
 * shim turns into the original upstream failure.
 *
 * @param {object} options
 * @param {object} options.body      Parsed OpenAI request body.
 * @param {{kind?: string, status?: number, message?: string}} options.failure
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.spawnImpl]
 * @returns {Promise<{ok: true, sse: string, attempted: true} | {ok: false, message: string, attempted: boolean, reason: string}>}
 */
export async function cliFallbackSse({ body, failure, env = process.env, timeoutMs, signal, spawnImpl }) {
  const model = typeof body?.model === 'string' ? body.model : null
  if (!isCliFallbackEligible(model, failure)) {
    return { ok: false, message: failure?.message ?? 'not eligible', attempted: false, reason: 'not-eligible' }
  }
  const resolved = resolveCli({ env })
  if (resolved.path === null) {
    const message = resolved.reason === 'missing-cli-path'
      ? `qoder CLI fallback: QODER_CLI_PATH is set but no such file exists (${env.QODER_CLI_PATH})`
      : 'qoder CLI binary not found (QODER_CLI_PATH unset and no well-known install)'
    return { ok: false, message, attempted: false, reason: resolved.reason }
  }
  const prompt = promptFromBody(body)
  if (prompt.length === 0) {
    return { ok: false, message: 'qoder CLI fallback: request carries no user prompt', attempted: false, reason: 'no-prompt' }
  }
  const contextWindow = typeof body?.context_window === 'number' && Number.isFinite(body.context_window) && body.context_window > 0
    ? Math.floor(body.context_window)
    : 1_000_000
  const run = await runCliCompletion({ cliPath: resolved.path, model, contextWindow, prompt, timeoutMs, signal, spawnImpl })
  if (!run.ok) {
    return {
      ok: false,
      message: run.message,
      attempted: true,
      reason: CLI_FAILURE_REASONS.has(run.reason) ? run.reason : 'error',
    }
  }
  return { ok: true, sse: wrapAsSse(model, run.text), attempted: true }
}
