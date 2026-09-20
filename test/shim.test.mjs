// Tests for the loopback shim's security gates and route contract.
//
// These are the checks that decide whether an unprivileged local process or a
// web page can reach the Qoder credential. Each gate gets its own case so a
// regression names exactly which one opened.

import assert from 'node:assert/strict'

let pass = 0
let fail = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ok   ${name}`)
  } catch (error) {
    fail++
    failures.push({ name, error })
    console.log(`  FAIL ${name}`)
    console.log(`       ${error.message.split('\n')[0]}`)
  }
}

const shimMod = await import('../lib/qoder/shim.js').catch((e) => ({ __err: e }))

if (shimMod.__err) {
  console.log(`  FAIL import lib/qoder/shim.js :: ${shimMod.__err.code ?? shimMod.__err.message}`)
  fail++
} else {
  const { hostIsLoopback, originIsLoopback, createQoderShim } = shimMod

  await test('hostIsLoopback accepts loopback hosts with and without a port', () => {
    for (const host of ['127.0.0.1', '127.0.0.1:51234', 'localhost', 'localhost:8080', '[::1]:9000']) {
      assert.equal(hostIsLoopback(host), true, `expected ${host} to be loopback`)
    }
  })

  await test('hostIsLoopback rejects remote and spoofed hosts', () => {
    for (const host of ['evil.com', '127.0.0.1.evil.com', '10.0.0.1', '', undefined, null]) {
      assert.equal(hostIsLoopback(host), false, `expected ${String(host)} to be rejected`)
    }
  })

  await test('originIsLoopback accepts absent and loopback origins', () => {
    assert.equal(originIsLoopback(undefined), true)
    assert.equal(originIsLoopback('http://127.0.0.1:43129'), true)
    assert.equal(originIsLoopback('http://localhost:3000'), true)
  })

  await test('originIsLoopback rejects a remote origin', () => {
    assert.equal(originIsLoopback('https://evil.com'), false)
    assert.equal(originIsLoopback('not a url'), false)
  })

  // ---- Live shim over a real loopback socket ----

  const catalog = () => [{ id: 'auto', name: 'Auto' }]
  const store = {
    resolve: async () => ({ credential: { token: 'DT' }, machineId: 'M1' }),
  }
  const calls = []
  const client = {
    chatStream: async (cred, body) => {
      calls.push({ cred, body })
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return { ok: true, response: new Response(stream, { status: 200 }) }
    },
  }

  const shim = createQoderShim({ store, client, catalog })
  await shim.ready
  const base = shim.baseUrl()
  const token = shim.token()

  await test('binds an ephemeral loopback port, not a fixed one', () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.notEqual(base, 'http://127.0.0.1:0')
  })

  await test('healthz answers without leaking anything', async () => {
    const res = await fetch(`${base}/healthz`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })

  await test('rejects a request with no bearer', async () => {
    const res = await fetch(`${base}/v1/models`)
    assert.equal(res.status, 401)
  })

  await test('rejects a request with the wrong bearer', async () => {
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: 'Bearer nope' } })
    assert.equal(res.status, 401)
  })

  await test('rejects a bearer of the right length but wrong bytes', async () => {
    const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${wrong}` } })
    assert.equal(res.status, 401)
  })

  await test('rejects a non-loopback Origin', async () => {
    const res = await fetch(`${base}/v1/models`, {
      headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.com' },
    })
    assert.equal(res.status, 403)
  })

  await test('lists the catalog in OpenAI list shape', async () => {
    const res = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.object, 'list')
    assert.equal(body.data[0].id, 'auto')
    assert.equal(body.data[0].owned_by, 'qoder')
  })

  await test('404s an unknown route', async () => {
    const res = await fetch(`${base}/v1/nope`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 404)
  })

  await test('relays a chat completion and forwards the resolved credential', async () => {
    calls.length = 0
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(res.status, 200)
    const text = await res.text()
    assert.match(text, /"content":"hi"/)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].cred.machineId, 'M1')
    assert.equal(calls[0].body.model, 'auto')
  })

  await test('rejects a chat body that is not JSON content-type', async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      body: 'model=auto',
    })
    assert.equal(res.status, 415)
  })

  await test('rejects a chat body with no model', async () => {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    })
    assert.equal(res.status, 400)
  })

  await test('maps a not-signed-in store error to 401', async () => {
    const failing = createQoderShim({
      store: { resolve: async () => { throw new Error('Qoder is not signed in') } },
      client,
      catalog,
    })
    await failing.ready
    try {
      const res = await fetch(`${failing.baseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${failing.token()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: 'auto', messages: [] }),
      })
      assert.equal(res.status, 401)
    } finally {
      await failing.close()
    }
  })

  await test('maps an upstream auth_error to 401', async () => {
    const denied = createQoderShim({
      store,
      client: { chatStream: async () => ({ ok: false, kind: 'auth_error', status: 401, message: 'bad token' }) },
      catalog,
    })
    await denied.ready
    try {
      const res = await fetch(`${denied.baseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${denied.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'auto', messages: [] }),
      })
      assert.equal(res.status, 401)
      const body = await res.json()
      assert.equal(body.error.type, 'auth_error')
    } finally {
      await denied.close()
    }
  })

  await test('maps an upstream rate_limit to 429', async () => {
    const limited = createQoderShim({
      store,
      client: { chatStream: async () => ({ ok: false, kind: 'rate_limit', status: 429, message: 'slow' }) },
      catalog,
    })
    await limited.ready
    try {
      const res = await fetch(`${limited.baseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${limited.token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'auto', messages: [] }),
      })
      assert.equal(res.status, 429)
    } finally {
      await limited.close()
    }
  })

  await shim.close()
}

console.log('')
console.log(`== ${pass} passed, ${fail} failed ==`)
if (fail > 0) process.exitCode = 1
else console.log('ALL ASSERTIONS PASSED')
