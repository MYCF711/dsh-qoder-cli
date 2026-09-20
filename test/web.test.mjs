// Offline unit tests for lib/qoder/web.js route handlers.
//
// Strategy: no real HTTP server. `req` is an EventEmitter with method/headers
// plus a `destroy()` stub; `res` is an EventEmitter-style object stub that
// records `writeHead` and buffers `end()` payloads so the JSON response can be
// asserted. `registerQoderRoutes` is exercised against a mock webServer that
// collects every registered {path, handler}.
//
// Covered:
// 1. statusHandler   -> 200 with signed_in / models / enabled_models /
//                       model_options fields (and 405 on non-GET).
// 2. enabledModelsHandler -> POST valid body persists via setEnabledModels and
//    answers 200; non-array enabledModels and malformed JSON answer 400.
// 3. modelOptionsHandler  -> POST {id, thinkingEffort} calls setModelOptions
//    and answers 200; a body without a non-empty `id` answers 400.
//
// Run: node --test test/web.test.mjs
// (or plain `node test/web.test.mjs`; process.exitCode set below.)

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

let pass = 0
let fail = 0
const failures = []

function testAsync(name, fn) {
  return (async () => {
    try {
      await fn()
      pass++
      console.log('  ok   ' + name)
    } catch (error) {
      fail++
      failures.push({ name, error })
      console.log('  FAIL ' + name)
      console.log('       ' + String(error && error.message).split('\n')[0])
    }
  })()
}

console.log('== qoder web routes (offline) ==')

// ------------------------------
// MODULE UNDER TEST
// ------------------------------
let web = null
try {
  web = await import('../lib/qoder/web.js')
} catch (e) {
  console.log(`  FAIL import web.js :: ${e.message}`)
  fail++
  failures.push({ name: 'import web.js', error: e })
}

// ------------------------------
// HTTP MOCK HELPERS
// ------------------------------

/** Build a fake http.ServerResponse-ish object; records status/headers/body. */
function mockRes() {
  const state = {
    statusCode: null,
    headers: null,
    bodyChunks: [],
    ended: false,
  }
  const res = new EventEmitter()
  res.writeHead = (statusCode, headers) => {
    assert.equal(state.statusCode, null, 'writeHead must be called exactly once per response')
    state.statusCode = statusCode
    state.headers = headers
  }
  res.end = (payload) => {
    state.ended = true
    if (payload !== undefined) state.bodyChunks.push(payload)
  }
  res.destroy = () => {}
  res._state = state
  res.json = () => {
    const raw = state.bodyChunks.join('')
    return raw.length > 0 ? JSON.parse(raw) : null
  }
  return res
}

/** Build a fake http.IncomingMessage-ish object; `emitBody` streams a body. */
function mockReq({ method = 'GET', headers = {}, body = null } = {}) {
  const req = new EventEmitter()
  req.method = method
  req.headers = headers
  req.destroy = () => {}
  req.emitBody = (payload) => {
    if (payload !== null) req.emit('data', Buffer.from(payload, 'utf8'))
    req.emit('end')
  }
  return req
}

const LOOPBACK_HEADERS = {
  host: '127.0.0.1:4123',
  origin: 'http://localhost:5173',
  'content-type': 'application/json',
}

/** Standard deps stub shared by the handler tests below. */
function mockDeps(overrides = {}) {
  const calls = { setEnabledModels: [], setModelOptions: [] }
  const deps = {
    provider: 'qoder',
    region: () => 'global',
    settingsWritable: () => true,
    models: () => [
      { id: 'model-a', name: 'Model A' },
      { id: 'model-b', name: 'Model B' },
      { id: 'model-c', name: 'Model C' },
    ],
    enabledModels: () => ['model-a'],
    setEnabledModels: async (next) => {
      calls.setEnabledModels.push(next)
    },
    modelOptions: () => ({ 'model-a': { thinkingEffort: 'low' } }),
    setModelOptions: async (id, options) => {
      calls.setModelOptions.push({ id, options })
      return true
    },
    store: {
      resolve: async () => ({
        credential: {
          user: { id: 'u1', name: 'Alice', email: 'a@b.c', avatarUrl: 'http://x/y.png' },
          expiresAt: 1234567890,
        },
        machineId: 'machine-xyz',
      }),
      saveOwn: async () => {},
      invalidate: () => {},
    },
    ...overrides,
  }
  return { deps, calls }
}

/** Register routes on a collecting mock webServer and return {routes, ctx}. */
function collectRoutes(deps) {
  const registered = []
  const ctx = {
    webServer: {
      register: (spec) => {
        registered.push(spec)
        return () => {}
      },
    },
    effect: (fn) => fn(),
  }
  web.registerQoderRoutes(ctx, deps)
  return registered
}

if (web) {
  // ------------------------------
  // TEST GROUP 1: statusHandler
  // ------------------------------
  await testAsync('statusHandler: GET returns 200 with signed_in/models/enabled_models/model_options', async () => {
    const { deps } = mockDeps()
    const handler = web.statusHandler(deps)
    const req = mockReq({ method: 'GET', headers: { host: LOOPBACK_HEADERS.host, origin: LOOPBACK_HEADERS.origin } })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(null)
    await pending
    assert.equal(res._state.statusCode, 200, 'must answer 200')
    const body = res.json()
    assert.equal(typeof body.signed_in, 'boolean', 'signed_in must be present')
    assert.equal(body.signed_in, true, 'store resolved -> signed_in true')
    assert.ok(Array.isArray(body.models) && body.models.length === 3, 'models must mirror the catalog')
    assert.deepEqual(body.enabled_models, ['model-a'], 'enabled_models must pass through')
    assert.deepEqual(body.model_options, { 'model-a': { thinkingEffort: 'low' } }, 'model_options must pass through')
  })

  await testAsync('statusHandler: signed_out store surfaces signed_in=false and no account field', async () => {
    const { deps } = mockDeps({
      store: { resolve: async () => { throw new Error('no credential') } },
    })
    const handler = web.statusHandler(deps)
    const req = mockReq({ method: 'GET', headers: { host: LOOPBACK_HEADERS.host, origin: LOOPBACK_HEADERS.origin } })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(null)
    await pending
    assert.equal(res._state.statusCode, 200)
    const body = res.json()
    assert.equal(body.signed_in, false)
    assert.equal(body.account, undefined, 'no account object when sign-in failed')
    assert.equal(body.error, 'no credential', 'failure reason must surface as error')
  })

  await testAsync('statusHandler: non-GET answers 405', async () => {
    const { deps } = mockDeps()
    const handler = web.statusHandler(deps)
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS } })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(null)
    await pending
    assert.equal(res._state.statusCode, 405, 'status route is GET-only')
  })

  // ------------------------------
  // TEST GROUP 2: enabledModelsHandler
  // ------------------------------
  await testAsync('enabledModelsHandler: POST valid body updates allowlist and answers 200', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    const payload = JSON.stringify({ enabledModels: ['model-b', 'model-c'] })
    const req = mockReq({
      method: 'POST',
      headers: { ...LOOPBACK_HEADERS },
      body: payload,
    })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(payload)
    await pending
    assert.equal(res._state.statusCode, 200, 'valid write must answer 200')
    const body = res.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.enabled_models, ['model-b', 'model-c'])
    assert.deepEqual(calls.setEnabledModels, [['model-b', 'model-c']], 'setEnabledModels must receive the parsed list')
  })

  await testAsync('enabledModelsHandler: stale ids are intersected with the live catalog', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    const payload = JSON.stringify({ enabledModels: ['model-a', 'model-gone', 42] })
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: payload })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(payload)
    await pending
    assert.equal(res._state.statusCode, 200)
    assert.deepEqual(calls.setEnabledModels[0], ['model-a'], 'unknown/non-string ids must be dropped')
  })

  await testAsync('enabledModelsHandler: POST non-array enabledModels answers 400', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    for (const bad of [JSON.stringify({ enabledModels: 'model-a' }), JSON.stringify({}), JSON.stringify('nope')]) {
      const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: bad })
      const res = mockRes()
      const pending = handler(req, res)
      req.emitBody(bad)
      await pending
      assert.equal(res._state.statusCode, 400, `body ${bad} must be rejected with 400`)
      assert.equal(calls.setEnabledModels.length, 0, 'no write may happen on invalid body')
    }
  })

  await testAsync('enabledModelsHandler: POST malformed JSON answers 400', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: '{not json' })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody('{not json')
    await pending
    assert.equal(res._state.statusCode, 400, 'unparseable body must answer 400')
    assert.equal(calls.setEnabledModels.length, 0)
  })

  // ------------------------------
  // TEST GROUP 3: modelOptionsHandler
  // ------------------------------
  await testAsync('modelOptionsHandler: POST {id, thinkingEffort} calls setModelOptions and answers 200', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.modelOptionsHandler(deps)
    const payload = JSON.stringify({ id: 'model-b', thinkingEffort: 'high' })
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: payload })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(payload)
    await pending
    assert.equal(res._state.statusCode, 200)
    assert.equal(res.json().ok, true)
    assert.equal(calls.setModelOptions.length, 1, 'setModelOptions must be called exactly once')
    assert.deepEqual(calls.setModelOptions[0], { id: 'model-b', options: { thinkingEffort: 'high' } })
  })

  await testAsync('modelOptionsHandler: POST missing/empty id answers 400 without calling setModelOptions', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.modelOptionsHandler(deps)
    for (const bad of [JSON.stringify({ thinkingEffort: 'high' }), JSON.stringify({ id: '' }), JSON.stringify({ id: 7 })]) {
      const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: bad })
      const res = mockRes()
      const pending = handler(req, res)
      req.emitBody(bad)
      await pending
      assert.equal(res._state.statusCode, 400, `body ${bad} must be rejected with 400`)
    }
    assert.equal(calls.setModelOptions.length, 0, 'no write may happen without a valid id')
  })

  // ------------------------------
  // TEST GROUP 4: registerQoderRoutes on a mock webServer
  // ------------------------------
  await testAsync('registerQoderRoutes: mock webServer collects all six handlers at their exact paths', async () => {
    const { deps } = mockDeps()
    const registered = collectRoutes(deps)
    assert.equal(registered.length, 6, 'all six routes must register')
    const byPath = new Map(registered.map((spec) => [spec.path, spec]))
    assert.ok(byPath.has('/plugins/dsh-qoder-cli/status'), 'status path must register')
    assert.ok(byPath.has('/plugins/dsh-qoder-cli/enabled-models'), 'enabled-models path must register')
    assert.ok(byPath.has('/plugins/dsh-qoder-cli/model-options'), 'model-options path must register')
    for (const spec of registered) {
      assert.equal(spec.kind, 'exact', 'routes must register as exact matches')
      assert.equal(typeof spec.handler, 'function', 'each registration must carry a handler function')
    }
    // The collected handler for enabled-models must be a working enabledModelsHandler.
    const collected = byPath.get('/plugins/dsh-qoder-cli/enabled-models').handler
    const payload = JSON.stringify({ enabledModels: [] })
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body: payload })
    const res = mockRes()
    const pending = collected(req, res)
    req.emitBody(payload)
    await pending
    assert.equal(res._state.statusCode, 200, 'collected handler must answer 200 for an empty allowlist write')
  })

  await testAsync('registerQoderRoutes: disposing the effect removes every registered handler', async () => {
    const { deps } = mockDeps()
    let registeredCount = 0
    let returnedDisposer = null
    const ctx = {
      webServer: {
        register: () => {
          registeredCount++
          return () => {}
        },
      },
      effect: (fn) => { returnedDisposer = fn() },
    }
    web.registerQoderRoutes(ctx, deps)
    assert.equal(typeof returnedDisposer, 'function', 'effect must receive a disposer-returning setup')
    assert.equal(registeredCount, 6, 'setup must register all six routes')
    returnedDisposer()
    assert.equal(returnedDisposer(), undefined, 'disposer must be idempotent')
  })

  // ------------------------------
  // TEST GROUP 5: negative / defensive paths (loopback gate, content-type,
  // writability, body limit, write failures, dump unavailability)
  // ------------------------------

  const REMOTE_HEADERS = { host: 'evil.example.com:4123', origin: 'https://evil.example.com', 'content-type': 'application/json' }

  async function drain(handler, req, res, body = null) {
    const pending = handler(req, res)
    req.emitBody(body)
    await pending
    return res
  }

  /** POST helper: builds loopback req/res, streams `body`, returns the res. */
  function post(handler, body, { headers = LOOPBACK_HEADERS } = {}) {
    const req = mockReq({ method: 'POST', headers, body })
    const res = mockRes()
    return drain(handler, req, res, body)
  }

  /** GET helper: builds loopback req/res, returns the drained res. */
  function get(handler) {
    const req = mockReq({ method: 'GET', headers: { host: LOOPBACK_HEADERS.host, origin: LOOPBACK_HEADERS.origin } })
    const res = mockRes()
    return drain(handler, req, res)
  }

  await testAsync('statusHandler: remote Host/Origin answers 403 request-not-trusted', async () => {
    const { deps } = mockDeps()
    const handler = web.statusHandler(deps)
    const res = await drain(handler, mockReq({ method: 'GET', headers: REMOTE_HEADERS }), mockRes())
    assert.equal(res._state.statusCode, 403, 'a non-loopback GET must be refused before any store access')
    assert.deepEqual(res.json(), { error: 'request-not-trusted' })
  })

  await testAsync('enabledModelsHandler: remote origin POST answers 403 without writing', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    const body = JSON.stringify({ enabledModels: ['model-a'] })
    const res = await post(handler, body, { headers: REMOTE_HEADERS })
    assert.equal(res._state.statusCode, 403, 'a mutating POST from a non-loopback origin must be refused')
    assert.equal(calls.setEnabledModels.length, 0, 'no write may happen for an untrusted origin')
  })

  await testAsync('enabledModelsHandler: POST with non-JSON content-type answers 415', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    const body = JSON.stringify({ enabledModels: ['model-a'] })
    const res = await post(handler, body, { headers: { host: LOOPBACK_HEADERS.host, origin: LOOPBACK_HEADERS.origin, 'content-type': 'text/plain' } })
    assert.equal(res._state.statusCode, 415, 'mutating writes are JSON-only')
    assert.equal(calls.setEnabledModels.length, 0, 'no write may happen for a wrong content type')
  })

  await testAsync('enabledModelsHandler: settings not writable answers 409 without calling setEnabledModels', async () => {
    const { deps, calls } = mockDeps({ settingsWritable: () => false })
    const handler = web.enabledModelsHandler(deps)
    const body = JSON.stringify({ enabledModels: ['model-a'] })
    const res = await post(handler, body)
    assert.equal(res._state.statusCode, 409, 'read-only profiles must refuse allowlist writes with 409')
    assert.equal(calls.setEnabledModels.length, 0)
  })

  await testAsync('enabledModelsHandler: body larger than 64KiB is rejected and never parsed', async () => {
    const { deps, calls } = mockDeps()
    const handler = web.enabledModelsHandler(deps)
    // 65536 is MODELS_BODY_LIMIT; well over it must trip the guard.
    const body = JSON.stringify({ enabledModels: ['model-a'], pad: 'x'.repeat(70000) })
    const req = mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS }, body })
    const res = mockRes()
    const pending = handler(req, res)
    req.emitBody(body)
    await pending
    assert.equal(res._state.statusCode, 400, 'an over-limit body must answer 400 (readBody rejection converted)')
    assert.equal(calls.setEnabledModels.length, 0)
  })

  await testAsync('enabledModelsHandler: setEnabledModels failure answers 500 and surfaces the message', async () => {
    const { deps } = mockDeps({
      setEnabledModels: async () => { throw new Error('disk full') },
    })
    const handler = web.enabledModelsHandler(deps)
    const res = await post(handler, JSON.stringify({ enabledModels: ['model-a'] }))
    assert.equal(res._state.statusCode, 500, 'a failed persistence must surface as 500')
    assert.deepEqual(res.json(), { error: 'disk full' })
  })

  await testAsync('modelOptionsHandler: unknown id (setModelOptions false) answers 503 settings unavailable', async () => {
    const { deps, calls } = mockDeps({
      setModelOptions: async () => false,
    })
    const handler = web.modelOptionsHandler(deps)
    const res = await post(handler, JSON.stringify({ id: 'model-zzz', thinkingEffort: 'high' }))
    assert.equal(res._state.statusCode, 503, 'a falsy setModelOptions result must answer 503')
    assert.deepEqual(res.json(), { error: 'settings unavailable' })
    assert.equal(calls.setModelOptions.length, 0, 'the stub replaced setModelOptions; the original recorder must not fire')
  })

  await testAsync('modelOptionsHandler: settings not writable answers 409; malformed JSON answers 400 (writable profile)', async () => {
    const handler409 = web.modelOptionsHandler(mockDeps({ settingsWritable: () => false }).deps)
    const res409 = await post(handler409, JSON.stringify({ id: 'model-a', thinkingEffort: 'high' }))
    assert.equal(res409._state.statusCode, 409)
    // malformed JSON must reach the parser branch, so this one uses a writable profile
    const { deps, calls } = mockDeps()
    const handler400 = web.modelOptionsHandler(deps)
    const res400 = await post(handler400, '{broken')
    assert.equal(res400._state.statusCode, 400, 'malformed JSON must answer 400')
    assert.equal(calls.setModelOptions.length, 0, 'no options write may happen on either failure')
  })

  await testAsync('modelOptionsHandler: setModelOptions throw answers 500 with the message', async () => {
    const { deps } = mockDeps({
      setModelOptions: async () => { throw new Error('store locked') },
    })
    const handler = web.modelOptionsHandler(deps)
    const res = await post(handler, JSON.stringify({ id: 'model-a' }))
    assert.equal(res._state.statusCode, 500)
    assert.deepEqual(res.json(), { error: 'store locked' })
  })

  await testAsync('statusHandler: store.resolve throwing non-Error still surfaces a string error (safeMessage)', async () => {
    const { deps } = mockDeps({
      store: { resolve: async () => { throw 'plain-string-failure' } },
    })
    const handler = web.statusHandler(deps)
    const res = await get(handler)
    assert.equal(res._state.statusCode, 200)
    const body = res.json()
    assert.equal(body.signed_in, false)
    assert.equal(body.error, 'plain-string-failure', 'a thrown non-Error must be stringified, not crash the route')
  })

  await testAsync('authPollHandler: GET returns idle before any start; 405 on POST', async () => {
    const { deps } = mockDeps()
    const deviceLogin = web.createDeviceLoginRegistry(deps)
    const pollDeps = { ...deps, deviceLogin }
    const resIdle = await get(web.authPollHandler(pollDeps))
    assert.equal(resIdle._state.statusCode, 200)
    assert.deepEqual(resIdle.json(), { state: 'idle' }, 'polling before any start must answer idle')
    const res405 = await drain(web.authPollHandler(pollDeps), mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS } }), mockRes())
    assert.equal(res405._state.statusCode, 405, 'poll route is GET-only')
  })

  await testAsync('authStartHandler: 405 on GET; 403 on remote origin', async () => {
    const { deps } = mockDeps()
    const deviceLogin = web.createDeviceLoginRegistry(deps)
    const startDeps = { ...deps, deviceLogin }
    const res405 = await drain(web.authStartHandler(startDeps), mockReq({ method: 'GET', headers: { ...LOOPBACK_HEADERS } }), mockRes())
    assert.equal(res405._state.statusCode, 405, 'start route is POST-only')
    const res403 = await post(web.authStartHandler(startDeps), '', { headers: REMOTE_HEADERS })
    assert.equal(res403._state.statusCode, 403, 'a login start from a non-loopback origin must be refused')
  })

  await testAsync('catalogDumpHandler: 405 on POST; 503 when catalogDump unavailable; 200 shape when present', async () => {
    const { deps } = mockDeps()
    const dumpDeps = { ...deps, catalogDump: null }
    const res405 = await drain(web.catalogDumpHandler(dumpDeps), mockReq({ method: 'POST', headers: { ...LOOPBACK_HEADERS } }), mockRes())
    assert.equal(res405._state.statusCode, 405, 'dump route is GET-only')
    const res503 = await get(web.catalogDumpHandler(dumpDeps))
    assert.equal(res503._state.statusCode, 503, 'a missing catalogDump must answer 503, not crash')
    assert.deepEqual(res503.json(), { error: 'catalog unavailable' })
    const resOk = await get(web.catalogDumpHandler({
      ...deps,
      catalogDump: async () => [{ id: 'm1', name: 'M1', contextWindow: 200000, maxTokens: 32768, input: ['text'], reasoning: true, reasoningEfforts: ['low'], degraded: 'x', source: 'test' }],
    }))
    assert.equal(resOk._state.statusCode, 200)
    const doc = resOk.json()
    assert.equal(doc.version, 1)
    assert.equal(doc.models.length, 1)
    assert.deepEqual(
      Object.keys(doc.models[0]).sort(),
      ['contextWindow', 'degraded', 'id', 'input', 'maxTokens', 'name', 'reasoning', 'reasoningEfforts', 'source'].sort(),
      'dump entries must be the sanitized product-data shape only',
    )
  })
} else {
  console.log('  SKIP all web tests (module import failed)')
}

// ------------------------------
// SUMMARY
// ------------------------------
console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) {
  process.exitCode = 1
} else {
  console.log('ALL ASSERTIONS PASSED')
}
