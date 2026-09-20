/**
 * DSH Qoder connector — browser half.
 *
 * Registers the settings card under Plugin configuration. The card renders as
 * an expandable card with a collapsible header (matching the CodeBuddy card's
 * shape): a chevron header with title + description, and the body holds the
 * sign-in state, the device-login button, and the offered-model checkboxes.
 *
 * Deliberately defensive: the model channel is a Host concern, so if a future
 * DSH slot-API change breaks this card, the provider must keep working. The
 * whole body is wrapped so such a break degrades to a console error instead of
 * raising the "Failed to load plugins" banner.
 *
 * @module dsh-qoder-cli/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-qoder-cli',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const react = require('react')

    /** Host routes this card consumes. Mirrors lib/qoder/constants.js. */
    const STATUS_PATH = '/plugins/dsh-qoder-cli/status'
    const MODELS_PATH = '/plugins/dsh-qoder-cli/enabled-models'
    const AUTH_START_PATH = '/plugins/dsh-qoder-cli/auth/start'
    const AUTH_POLL_PATH = '/plugins/dsh-qoder-cli/auth/poll'
    const MODEL_OPTIONS_PATH = '/plugins/dsh-qoder-cli/model-options'

    const h = react.createElement

    /** Read the host status document. */
    async function fetchStatus() {
      const res = await fetch(STATUS_PATH, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    }

    /** Persist the enabled-model allowlist. */
    async function saveEnabledModels(ids) {
      const res = await fetch(MODELS_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: ids }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `status ${res.status}`)
      }
      return res.json()
    }

    /** Begin one device-login attempt; the host returns the login URL. */
    async function startAuth() {
      const res = await fetch(AUTH_START_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error ?? `status ${res.status}`)
      }
      return res.json()
    }

    /** Read the running login attempt's state. */
    async function pollAuth() {
      const res = await fetch(AUTH_POLL_PATH, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return res.json()
    }

    /** Small labelled row used inside the body. */
    function row(label, value) {
      return h(
        'div',
        { style: { display: 'flex', gap: '8px', fontSize: '13.5px', lineHeight: '20px', minWidth: 0 } },
        h('span', { style: { opacity: 0.5, width: '72px', flex: 'none' } }, label),
        h('span', { style: { wordBreak: 'break-all', minWidth: 0, flex: 1, fontWeight: 500 } }, value ?? '—'),
      )
    }

    /**
     * Deterministic avatar background tone for a name — the CodeBuddy
     * original scheme: six fixed extremely light rgba fills picked by name
     * hash, paired with dark label-primary text. Contrast is guaranteed on
     * both themes by the near-transparent wash (the earlier saturated HSL
     * gradient with white text failed WCAG on 211/360 hues).
     */
    const AVATAR_TONES = [
      'rgba(77,107,254,0.14)',  // brand blue
      'rgba(46,160,67,0.14)',   // green
      'rgba(163,106,3,0.14)',   // amber
      'rgba(136,78,206,0.14)',  // purple
      'rgba(31,143,166,0.14)',  // teal
      'rgba(200,60,60,0.14)',   // red
    ]
    function avatarTone(name) {
      let hash = 0
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
      return AVATAR_TONES[hash % AVATAR_TONES.length]
    }

    /**
     * Expiry urgency for one token (docs/ACCOUNT-UI-REFERENCE.md 建议 2:
     * CodeBuddy's two-state chip upgraded with zquota's urgency idea).
     * Returns null when there is no usable date; otherwise
     * `{ tone: 'danger'|'warning'|'neutral', label, full }` — tone drives the
     * chip colour, `label` is the chip text, `full` the localised date for
     * tooltips and the detail rows.
     */
    function expiryChip(value, now = Date.now()) {
      if (value === undefined || value === null || value === '') return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return { tone: 'neutral', label: String(value), full: String(value) }
      const full = date.toLocaleString('zh-CN', { hour12: false })
      const msLeft = date.getTime() - now
      if (msLeft < 0) return { tone: 'danger', label: '已过期', full }
      const daysLeft = Math.floor(msLeft / (24 * 60 * 60 * 1000))
      if (daysLeft < 7) return { tone: 'warning', label: daysLeft <= 0 ? '不足 1 天后过期' : `${daysLeft} 天后过期`, full }
      return { tone: 'neutral', label: full, full }
    }

    /** Render one expiry chip with the three tones (danger/warning/neutral).
     *  Green text uses the darker fixed tone (#1a7f37) — the pill background
     *  is a translucent wash of the same hue family, so the lighter
     *  state-success-primary fails AA against it (v7 review M1). */
    function expiryChipEl(chip, props = {}) {
      if (chip === null) return null
      const tone =
        chip.tone === 'danger'
          ? { background: 'rgba(163,30,30,0.14)', color: 'var(--dsw-alias-state-error-primary, rgb(200,60,60))' }
          : chip.tone === 'warning'
            ? { background: 'rgba(163,106,3,0.16)', color: 'rgb(154,103,0)' }
            : { background: 'rgba(46,160,67,0.14)', color: '#1a7f37' }
      return h(
        'span',
        {
          title: chip.full,
          style: {
            display: 'inline-block',
            flex: 'none',
            fontSize: '11px',
            padding: '1px 8px',
            borderRadius: '999px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            ...tone,
          },
        },
        chip.label,
      )
    }

    /**
     * Compact two-column info grid for the status block (t10-1): five
     * label/value rows pack into a 2×3 grid (区域 spans naturally into the
     * odd last cell), halving the vertical space the stacked rows used.
     * Keeps the same `row()` children — only the container layout changes.
     */
    function statusGrid(rows) {
      return h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)',
            columnGap: '14px',
            rowGap: '6px',
          },
        },
        ...rows,
      )
    }

    /** Open the login URL in a new tab; the card then polls for completion. */
    function openLoginUrl(url) {
      try {
        window.open(url, '_blank', 'noopener')
      } catch {
        // Popup blocked: fall through — the poll state row shows the URL.
      }
    }

    /**
     * The plugin settings card body.
     *
     * Shows the resolved Qoder account, a device-login entry (the same flow the
     * Qoder desktop app drives: the browser opens qoder.com's device page, the
     * plugin polls for the token and stores it in its own credential file), and
     * the offered-model checkboxes. Selecting none means "offer everything".
     */
    function QoderPluginCardBody() {
      const [status, setStatus] = react.useState(null)
      const [error, setError] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [selected, setSelected] = react.useState(null)
      const [loginState, setLoginState] = react.useState({ state: 'idle' })
      const [loginBusy, setLoginBusy] = react.useState(false)
      const [loginUrl, setLoginUrl] = react.useState(null)
      // t10-3: React inline styles cannot express :hover, so the row hover
      // tint is driven by this visual-only state (no business semantics).
      const [hoverId, setHoverId] = react.useState(null)
      // t16: which of the two body tabs is active (状态 / 可选模型).
      const [activeTab, setActiveTab] = react.useState('status')
      // t16: the account card's expandable resource-detail section — one
      // boolean: click the card head to reveal everything at once.
      const [detailOpen, setDetailOpen] = react.useState(false)

      const load = react.useCallback(async () => {
        try {
          const next = await fetchStatus()
          setStatus(next)
          setSelected(new Set(next.enabled_models ?? []))
          setError(null)
        } catch (caught) {
          setError(caught.message)
        }
      }, [])

      react.useEffect(() => {
        void load()
      }, [load])

      // While a login attempt runs, poll its state every 2s.
      react.useEffect(() => {
        if (loginState.state !== 'pending') return undefined
        const timer = setInterval(async () => {
          try {
            const next = await pollAuth()
            setLoginState(next)
            if (next.state === 'signed_in') {
              setLoginUrl(null)
              void load()
            } else if (next.state === 'error') {
              setLoginUrl(null)
            }
          } catch {
            // Transient poll failures are not fatal; the next tick retries.
          }
        }, 2000)
        return () => clearInterval(timer)
      }, [loginState.state, load])

      const toggle = async (id) => {
        const next = new Set(selected ?? [])
        if (next.has(id)) next.delete(id)
        else next.add(id)
        setSelected(next)
        setBusy(true)
        try {
          await saveEnabledModels([...next])
          setError(null)
        } catch (caught) {
          setError(caught.message)
        } finally {
          setBusy(false)
        }
      }

      /** Persist one per-model option (context tier / thinking effort). */
      const setModelOptions = async (id, options) => {
        setBusy(true)
        try {
          const response = await fetch(MODEL_OPTIONS_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ id, ...options }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setError(null)
          load()
        } catch (caught) {
          setError(caught.message)
        } finally {
          setBusy(false)
        }
      }

      const beginLogin = async () => {
        setLoginBusy(true)
        try {
          const started = await startAuth()
          setLoginUrl(started.url ?? null)
          setLoginState({ state: 'pending', url: started.url })
          if (started.url) openLoginUrl(started.url)
        } catch (caught) {
          setLoginState({ state: 'error', error: caught.message })
        } finally {
          setLoginBusy(false)
        }
      }

      if (status === null) {
        return h(
          'div',
          { style: { padding: '4px 0', fontSize: '13px' } },
          error === null ? '正在加载 Qoder 状态…' : `Qoder 状态不可用：${error}`,
        )
      }

      const account = status.account ?? {}

      // ------------------------------------------------------------------
      // Tab content builders (t16). Each returns the element list for one
      // tab; the business handlers above are consumed unchanged.
      // ------------------------------------------------------------------

      /** Tab 1 — 账号管理: a CodeBuddy-style account card (avatar + chips +
       *  footer pill). Renders the same card shape per account; today there
       *  is exactly one. The device-login entry lives above the tab bar. */
      const buildStatusTab = () => {
        const items = []
        if (status.signed_in) {
          const displayName = account.name ?? account.email ?? 'Qoder'
          const chip = expiryChip(account.expires_at)
          // Quota blocks from the t15 backend (web.js buildStatus →
          // status.quota; absent when the upstream call failed). Missing
          // numbers degrade to '—' rather than pretending zero usage.
          const quota = status.quota ?? null
          const sub = quota?.userQuota ?? null
          const packs = quota?.addOnQuota ?? null
          const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          const fmt = (v) => num(v)?.toLocaleString('zh-CN') ?? '—'
          const pctText = (block) => {
            const p = num(block?.percentage)
            return p === null ? '已使用 —' : `已使用 ${Math.round(p * 100)}%`
          }
          const pctWidth = (block) => {
            const p = num(block?.percentage)
            return p === null ? '0%' : `${Math.max(0, Math.min(100, Math.round(p * 100)))}%`
          }
          // Header "剩余 Credits": the sum of the subscription and add-on
          // remainings (v7 layout). Either block may be missing — a missing
          // side contributes 0 only when the other side is present; both
          // missing renders '—'.
          const rem = (block) => num(block?.remaining)
          const remainingCredits =
            rem(sub) !== null || rem(packs) !== null ? (rem(sub) ?? 0) + (rem(packs) ?? 0) : null
          // Campaign (sign-in benefit) state from the backend (status.campaign).
          // The claim action itself lives in Qoder's web campaign page — the
          // only honest action here is opening that page (no fake one-click).
          const campaign = status.campaign ?? null
          const claimed = campaign?.claimStatus === 'CLAIMED'
          const claimableCampaign =
            campaign?.hasCampaign === true &&
            !claimed &&
            typeof campaign.campaignUrl === 'string' &&
            campaign.campaignUrl.length > 0
          const benefitAmount = num(campaign?.benefit?.amount)
          items.push(
            h(
              'article',
              {
                key: 'account-card',
                style: {
                  border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                  borderRadius: '10px',
                  overflow: 'hidden',
                  background: 'var(--dsw-alias-bg-layer-1, transparent)',
                },
              },
              // Header: avatar circle + name/email + online dot, like the
              // CodeBuddy AccountCard header. Clicking anywhere on it toggles
              // the resource-detail section (single boolean).
              h(
                'header',
                {
                  key: 'head',
                  onClick: () => setDetailOpen((value) => !value),
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    userSelect: 'none',
                  },
                },
                h(
                  'div',
                  {
                    style: {
                      flex: 'none',
                      minWidth: '34px',
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      overflow: 'hidden',
                      background: avatarTone(displayName),
                      // Dark text on the near-transparent wash (CodeBuddy
                      // original avatarStyle), not white — keeps WCAG
                      // contrast on both themes.
                      color: 'var(--dsw-alias-label-primary, inherit)',
                      fontSize: '15px',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textTransform: 'uppercase',
                    },
                  },
                  // Progressive avatar: the server avatar when present, with
                  // a first-letter fallback on load error and no URL at all
                  // (docs/ACCOUNT-UI-REFERENCE.md 建议 1).
                  account.avatar_url
                    ? h('img', {
                        key: 'avatar-img',
                        src: account.avatar_url,
                        alt: displayName,
                        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
                        onError: (event) => {
                          event.currentTarget.style.display = 'none'
                          const fallback = event.currentTarget.nextElementSibling
                          if (fallback) fallback.style.display = 'flex'
                        },
                      })
                    : null,
                  h(
                    'span',
                    {
                      key: 'avatar-fallback',
                      style: {
                        display: account.avatar_url ? 'none' : 'flex',
                        width: '100%',
                        height: '100%',
                        alignItems: 'center',
                        justifyContent: 'center',
                      },
                    },
                    displayName.charAt(0),
                  ),
                ),
                h(
                  'div',
                  { style: { minWidth: 0, flex: 1 } },
                  h(
                    'div',
                    {
                      title: displayName,
                      style: { fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    },
                    displayName,
                  ),
                  account.email && account.email !== displayName
                    ? h(
                        'div',
                        { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, inherit)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        account.email,
                      )
                    : null,
                ),
                // Remaining Credits column (v7 layout): total of the t15
                // quota blocks, brand-coloured, centred — never squeezed.
                h(
                  'div',
                  {
                    style: {
                      flex: 'none',
                      minWidth: '96px',
                      textAlign: 'center',
                    },
                  },
                  h(
                    'div',
                    {
                      title: '剩余 Credits（订阅 + 资源包）',
                      style: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-brand-primary, #4d6bfe)', whiteSpace: 'nowrap' },
                    },
                    fmt(remainingCredits),
                  ),
                  h('div', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary, inherit)' } }, '剩余 Credits'),
                ),
                // Right group: green dot + expiry chip + check-in + status
                // pill + chevron — one nowrap line.
                h(
                  'div',
                  {
                    style: {
                      flex: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      flexWrap: 'nowrap',
                      whiteSpace: 'nowrap',
                    },
                  },
                  h('span', {
                    title: '在线',
                    style: {
                      flex: 'none',
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--dsw-alias-state-success-primary, rgb(46,160,67))',
                      boxShadow: '0 0 4px rgba(46,160,67,0.3)',
                    },
                  }),
                  expiryChipEl(chip),
                  claimableCampaign
                    ? h(
                        'button',
                        {
                          key: 'signin-claimable',
                          title: `${benefitAmount !== null ? `领取 ${benefitAmount} credits` : '领取活动奖励'}：将在浏览器打开 Qoder 活动页完成领取`,
                          onClick: (event) => {
                            event.stopPropagation()
                            try {
                              window.open(campaign.campaignUrl, '_blank', 'noopener')
                            } catch {
                              // Popup blocked: the campaign page URL is also
                              // shown in the resource-detail section.
                            }
                          },
                          style: {
                            appearance: 'none',
                            flex: 'none',
                            font: 'inherit',
                            fontSize: '12px',
                            lineHeight: 1.5,
                            padding: '4px 12px',
                            borderRadius: '999px',
                            border: 'none',
                            background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
                            color: 'var(--dsw-alias-label-primary-foreground, #fff)',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          },
                        },
                        benefitAmount !== null ? `领取 ${benefitAmount} credits` : '领取活动奖励',
                      )
                    : claimed
                      ? h(
                          'span',
                          {
                            key: 'signin-claimed',
                            title: '本期活动奖励已领取',
                            style: {
                              flex: 'none',
                              fontSize: '12px',
                              lineHeight: 1.5,
                              padding: '4px 12px',
                              borderRadius: '999px',
                              background: 'rgba(46,160,67,0.14)',
                              color: '#1a7f37',
                              fontWeight: 500,
                              whiteSpace: 'nowrap',
                            },
                          },
                          '今日已领',
                        )
                      : h(
                          'span',
                          {
                            key: 'signin-none',
                            title: '当前没有进行中的签到活动（Qoder 活动为限时开放，可留意官方公告）',
                            style: {
                              flex: 'none',
                              fontSize: '12px',
                              lineHeight: 1.5,
                              padding: '4px 12px',
                              borderRadius: '999px',
                              background: 'var(--dsw-alias-bg-layer-3, rgba(128,128,128,0.12))',
                              color: 'var(--dsw-alias-label-secondary, inherit)',
                              whiteSpace: 'nowrap',
                            },
                          },
                          '暂无活动',
                        ),
                  status.signed_in
                    ? h(
                        'span',
                        {
                          style: {
                            flex: 'none',
                            fontSize: '12px',
                            padding: '3px 12px',
                            borderRadius: '999px',
                            background: 'rgba(46,160,67,0.14)',
                            color: '#1a7f37',
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                          },
                        },
                        '当前',
                      )
                    : h(
                        'button',
                        {
                          title: '将此账号设为当前使用账号',
                          style: {
                            appearance: 'none',
                            flex: 'none',
                            font: 'inherit',
                            fontSize: '12px',
                            padding: '3px 12px',
                            borderRadius: '999px',
                            border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                            background: 'var(--dsw-alias-bg-layer-3, transparent)',
                            color: 'inherit',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          },
                        },
                        '设为当前',
                      ),
                  h(
                    'span',
                    {
                      style: {
                        flex: 'none',
                        color: 'var(--dsw-alias-label-secondary, #999)',
                        fontSize: '12px',
                        transition: 'transform 0.16s',
                        display: 'inline-block',
                        transform: detailOpen ? 'rotate(180deg)' : 'none',
                      },
                    },
                    '▾',
                  ),
                ),
              ),
              // Body: the expandable resource-detail area (Qoder 用量明细
              // layout). Real values come from `status.quota` (t15 backend:
              // quota.js → /api/v2/quota/usage); when the quota block is
              // absent the sections degrade to an honest "数据不可用" note.
              detailOpen
                ? h(
                    'section',
                    {
                      key: 'body',
                      style: {
                        padding: '8px 12px 10px',
                        borderTop: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                      },
                    },
                    // ── ① 订阅版本的资源 ──
                    h(
                      'div',
                      { key: 'sub-title', style: { fontSize: '13px', fontWeight: 600 } },
                      '订阅版本的资源',
                    ),
                    h(
                      'div',
                      { key: 'sub-desc', style: { fontSize: '11.5px', opacity: 0.55, margin: '2px 0 8px' } },
                      '当前计划的月度配额与使用情况',
                    ),
                    sub === null
                      ? h(
                          'div',
                          { style: { fontSize: '11.5px', opacity: 0.5 } },
                          '配额数据不可用（可能是未登录或查询失败）',
                        )
                      : h(
                          'div',
                          {},
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
                            h('span', { style: { fontSize: '16px', fontWeight: 600 } }, `${fmt(sub.used)} / ${fmt(sub.total)}`),
                            h('span', { style: { fontSize: '11.5px', opacity: 0.55 } }, pctText(sub)),
                            h('span', { style: { marginLeft: 'auto', fontSize: '11.5px', opacity: 0.65, whiteSpace: 'nowrap' } }, `剩余 ${fmt(sub.remaining)}`),
                          ),
                          h(
                            'div',
                            {
                              style: {
                                marginTop: '6px',
                                height: '4px',
                                borderRadius: '2px',
                                background: 'var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                                overflow: 'hidden',
                              },
                            },
                            h('div', { style: { width: pctWidth(sub), height: '100%', background: 'var(--dsw-alias-brand-primary, #4d6bfe)' } }),
                          ),
                        ),
                    // ── ② 个人资源包 ──
                    h(
                      'div',
                      { key: 'packs-title', style: { fontSize: '13px', fontWeight: 600, marginTop: '14px' } },
                      '个人资源包',
                    ),
                    h(
                      'div',
                      { key: 'packs-desc', style: { fontSize: '11.5px', opacity: 0.55, margin: '2px 0 8px' } },
                      '通过活动或购买获得，仅供个人使用',
                    ),
                    packs === null
                      ? h(
                          'div',
                          { style: { fontSize: '11.5px', opacity: 0.5 } },
                          '暂无资源包数据（后端 quota 接口接入后显示明细）',
                        )
                      : h(
                          'div',
                          {},
                          h(
                            'div',
                            { style: { display: 'flex', alignItems: 'baseline', gap: '6px' } },
                            h('span', { style: { fontSize: '16px', fontWeight: 600 } }, `${fmt(packs.used)} / ${fmt(packs.total)}`),
                            h('span', { style: { fontSize: '11.5px', opacity: 0.55 } }, pctText(packs)),
                            h('span', { style: { marginLeft: 'auto', fontSize: '11.5px', opacity: 0.65, whiteSpace: 'nowrap' } }, `剩余 ${fmt(packs.remaining)}`),
                          ),
                          h(
                            'div',
                            {
                              style: {
                                marginTop: '6px',
                                height: '4px',
                                borderRadius: '2px',
                                background: 'var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                                overflow: 'hidden',
                              },
                            },
                            h('div', { style: { width: pctWidth(packs), height: '100%', background: 'var(--dsw-alias-brand-primary, #4d6bfe)' } }),
                          ),
                          typeof packs.detailUrl === 'string' && packs.detailUrl.length > 0
                            ? h(
                                'div',
                                { style: { marginTop: '6px' } },
                                h(
                                  'a',
                                  { href: packs.detailUrl, target: '_blank', rel: 'noopener noreferrer', style: { fontSize: '11.5px', color: 'var(--dsw-alias-brand-primary, #4d6bfe)' } },
                                  '查看资源包明细 →',
                                ),
                              )
                            : null,
                        ),
                  )
                : null,
            ),
          )
        } else {
          items.push(
            h(
              'div',
              { key: 'signed-out', style: { fontSize: '12px', opacity: 0.6, padding: '12px 0' } },
              '未登录：点击上方「登录 Qoder」完成设备码登录。',
            ),
          )
        }
        return items
      }

      /** Tab 2 — 可选模型: the per-model rows (t6-4 five-column grid). */
      const buildModelsTab = () => {
        const items = [
          h(
            'div',
            { key: 'models-label', style: { fontWeight: 600 } },
            '可选模型',
          ),
          h(
            'div',
            { key: 'models-hint', style: { fontSize: '12px', opacity: 0.6, marginBottom: '6px' } },
            status.enabled_models?.length
              ? '仅勾选的模型会出现在模型选择器中。'
              : '未勾选任何模型——等同提供全部模型。',
          ),
        ]
        for (const model of status.models ?? []) {
          const checked = (selected ?? new Set()).has(model.id)
          const opts = status.model_options?.[model.id] ?? {}
        // Price factor badge: ×N.NN (server billing multiplier for this model).
        // Grid column 5 (56px) handles placement; a quiet neutral tone keeps
        // it below the promo/degraded badges in the visual hierarchy (t10-4).
        const priceBadge =
          model.priceFactor !== undefined && model.priceFactor !== null
            ? h(
                'span',
                { style: { fontSize: '11px', opacity: 0.45, justifySelf: 'end', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } },
                `×${model.priceFactor}`,
              )
            : null
        // Green promo badge: server-side special status (夜间免费/限时免费/错峰N折…).
        const promoBadge =
          model.promotion?.active && model.promotion?.badge?.zh
            ? h(
                'span',
                {
                  title: model.promotion.description?.zh ?? model.promotion.description?.en ?? '',
                  style: {
                    flex: 'none',
                    fontSize: '11px',
                    padding: '0 6px',
                    borderRadius: '6px',
                    background: 'rgba(46,160,67,0.12)',
                    color: '#1a7f37',
                  },
                },
                model.promotion.badge.zh,
              )
            : null
        // Context-tier dropdown: only for models whose server directory offers
        // multiple labelled windows (200K/400K/1M …). Default tier preselected.
        const ctxSelect =
          Array.isArray(model.contextOptions) && model.contextOptions.length > 1
            ? h(
                'select',
                {
                  value: opts.contextLabel ?? (model.contextOptions.find((o) => o.isDefault)?.label ?? model.contextOptions[0].label),
                  disabled: busy || !status.selection_writable,
                  onChange: (event) => void setModelOptions(model.id, { contextLabel: event.target.value }),
                  style: { font: 'inherit', fontSize: '11px', padding: '2px 5px', borderRadius: '6px' },
                },
                ...model.contextOptions.map((option) =>
                  h('option', { key: option.label, value: option.label }, `${option.label} (${Math.round(option.tokens / 1000)}K)`),
                ),
              )
            : null
        // Thinking-effort dropdown: only for models that expose an effort ladder.
        const EFFORT_LABELS = { off: '关闭思考', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' }
        const effortSelect =
          Array.isArray(model.reasoningEfforts) && model.reasoningEfforts.length > 0
            ? (() => {
                const choices = ['off', ...model.reasoningEfforts]
                const current = opts.thinkingEffort ?? model.thinkingDefault ?? model.reasoningEfforts[0]
                return h(
                  'select',
                  {
                    value: choices.includes(current) ? current : model.reasoningEfforts[0],
                    disabled: busy || !status.selection_writable,
                    onChange: (event) => void setModelOptions(model.id, { thinkingEffort: event.target.value }),
                    style: { font: 'inherit', fontSize: '11px', padding: '2px 5px', borderRadius: '6px' },
                  },
                  ...choices.map((level) => h('option', { key: level, value: level }, EFFORT_LABELS[level] ?? level)),
                )
              })()
            : null
        // Model row as a five-column grid (t6-4): toggle | name(+badges) |
        // effort select | context select | price badge. Fixed tracks keep the
        // select columns aligned across rows regardless of model-name length;
        // null selects render an empty placeholder so the columns never
        // collapse (t6-5: no effort ladder; t6-8: single context tier).
        // t10-3: hover tint via visual-only hoverId state (React inline
        // styles cannot express :hover); t10-4: the degraded badge sits at
        // the row start with a warm tone while the price keeps a quiet
        // end-aligned neutral, so the two never blur together.
        items.push(
          h(
            'div',
            {
              key: `model-${model.id}`,
              style: {
                display: 'grid',
                gridTemplateColumns: '34px 1fr 96px 100px 56px',
                gap: '6px',
                alignItems: 'center',
                fontSize: '13px',
                padding: '5px 6px',
                margin: '0 -6px',
                borderRadius: '8px',
                transition: 'background 0.12s',
                ...(hoverId === model.id
                  ? { background: 'var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))' }
                  : {}),
              },
              onMouseEnter: () => setHoverId(model.id),
              onMouseLeave: () => setHoverId((current) => (current === model.id ? null : current)),
            },
            // Column 1: iOS-style toggle switch (green pill + sliding knob),
            // per the CodeBuddy card's 显示状态 control. A real checkbox is
            // kept for a11y, visually hidden under the pill; the name label
            // targets it via htmlFor so clicking the name still toggles.
            h(
              'span',
              { style: { position: 'relative', display: 'inline-block', width: '34px', height: '19px' } },
              h('input', {
                type: 'checkbox',
                id: `qoder-model-${model.id}`,
                checked,
                disabled: busy || !status.selection_writable,
                onChange: () => void toggle(model.id),
                style: { position: 'absolute', inset: 0, opacity: 0, margin: 0, cursor: 'pointer' },
              }),
              h('span', {
                style: {
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  borderRadius: '19px',
                  background: (busy || !status.selection_writable) ? 'var(--dsw-alias-border-l4, rgba(128,128,128,0.25))' : checked ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                  transition: 'background 0.15s',
                },
              }),
              h('span', {
                style: {
                  position: 'absolute',
                  top: '2px',
                  left: checked ? '17px' : '2px',
                  width: '15px',
                  height: '15px',
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
                  transition: 'left 0.15s',
                  pointerEvents: 'none',
                },
              }),
            ),
            // Column 2: model name + conditional badges.
            h(
              'label',
              {
                htmlFor: `qoder-model-${model.id}`,
                style: { display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 },
              },
              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, model.name),
              model.degraded
                ? h(
                    'span',
                    {
                      style: {
                        flex: 'none',
                        fontSize: '11px',
                        padding: '0 5px',
                        borderRadius: '6px',
                        // Ghost outline instead of a filled chip: next to the
                        // filled green promo badge it reads as secondary, so
                        // the two no longer compete (t17-2).
                        border: '0.5px solid rgba(163,106,3,0.45)',
                        color: 'rgb(154,103,0)',
                        opacity: 0.9,
                      },
                      title: model.degraded,
                    },
                    '不可用',
                  )
                : null,
              promoBadge,
            ),
            // Column 3: thinking-effort dropdown, or an empty placeholder.
            effortSelect ?? h('span', { key: 'effort-placeholder' }),
            // Column 4: context-tier dropdown (hidden for single-tier models),
            // or an empty placeholder keeping the last column aligned.
            ctxSelect ?? h('span', { key: 'ctx-placeholder' }),
            // Column 5: price badge (absent models leave the track empty).
            priceBadge,
          ),
        )
        }
        // Model-tab error line (save failures / status errors surface here).
        if (error !== null) {
          items.push(
            h('div', { key: 'err', style: { marginTop: '10px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #c33)' } }, error),
          )
        }
        return items
      }

      /** Tab 3 — 用量统计: real credits data from the backend
       *  (status.creditsTimeline = heatmap items + summary). Four aggregate
       *  cards (今日 / 近7天 / 本月 / 累计) and a per-day bar chart over the
       *  recent window. All numbers come from the server's own per-day
       *  accounting; there is deliberately NO per-model breakdown — Qoder
       *  exposes none (docs/API-RESEARCH-SIGNIN-USAGE.md §2.3). */
      const buildUsageTab = () => {
        const items = []
        const timeline = status.creditsTimeline ?? null
        const rows = Array.isArray(timeline?.items) ? timeline.items : []
        if (rows.length === 0) {
          items.push(
            h(
              'div',
              {
                key: 'usage-empty',
                style: {
                  marginTop: '10px',
                  padding: '14px 10px',
                  textAlign: 'center',
                  fontSize: '12px',
                  color: 'var(--dsw-alias-label-secondary, inherit)',
                  border: '0.5px dashed var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                  borderRadius: '10px',
                },
              },
              status.signed_in
                ? '暂无用量数据——服务器未返回 credits 时间线，稍后刷新重试。'
                : '登录后可查看 credits 用量统计。',
            ),
          )
          return items
        }
        const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
        const fmt = (v) => (num(v) === null ? '—' : num(v) % 1 === 0 ? num(v).toLocaleString('zh-CN') : num(v).toFixed(2))
        // Aggregates over the server-provided day list. "本月" counts the
        // calendar month of the latest entry in the returned window.
        const byDate = new Map(rows.map((row) => [row.date, row.value]))
        const latestDate = rows.length > 0 ? rows[rows.length - 1].date : null
        const monthPrefix = latestDate ? latestDate.slice(0, 7) : ''
        const today = latestDate ? byDate.get(latestDate) ?? 0 : 0
        let last7 = 0
        let month = 0
        for (let i = 0; i < 7 && i < rows.length; i++) last7 += rows[rows.length - 1 - i].value
        for (const row of rows) if (row.date.startsWith(monthPrefix)) month += row.value
        const total = num(timeline.total) ?? rows.reduce((sum, row) => sum + row.value, 0)
        const summary = timeline.summary ?? null
        const unit = timeline.unit ?? 'credits'
        const statCards = [
          { label: '今日消耗', value: today, title: `最新一天（${latestDate ?? '—'}）的 credits 消耗` },
          { label: '近 7 天', value: last7, title: '最近 7 天的 credits 消耗合计' },
          { label: '本月', value: month, title: `${monthPrefix ? monthPrefix : '当月'} 自然月的 credits 消耗合计` },
          {
            label: '累计总计',
            value: total,
            title: summary?.peakCredits !== undefined && summary?.peakCredits !== null
              ? `服务器累计统计（单日峰值 ${fmt(summary.peakCredits)}，出现在 ${summary.peakDate ?? '—'}）`
              : '服务器返回窗口内的 credits 合计',
          },
        ]
        items.push(
          h(
            'div',
            {
              key: 'usage-cards',
              style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '4px' },
            },
            ...statCards.map((card) =>
              h(
                'div',
                {
                  key: `stat-${card.label}`,
                  title: card.title,
                  style: {
                    border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                    borderRadius: '10px',
                    padding: '10px 8px',
                    textAlign: 'center',
                    background: 'var(--dsw-alias-bg-layer-1, transparent)',
                  },
                },
                h(
                  'div',
                  { style: { fontSize: '16px', fontWeight: 600, color: 'var(--dsw-alias-brand-primary, #4d6bfe)', whiteSpace: 'nowrap' } },
                  fmt(card.value),
                ),
                h('div', { style: { fontSize: '11px', marginTop: '2px', color: 'var(--dsw-alias-label-secondary, inherit)' } }, card.label),
              ),
            ),
          ),
        )
        if (summary?.peakCredits !== undefined && summary?.peakCredits !== null) {
          items.push(
            h(
              'div',
              { key: 'usage-summary', style: { marginTop: '6px', fontSize: '11px', opacity: 0.7 } },
              `单日峰值 ${fmt(summary.peakCredits)} ${unit}（${summary.peakDate ?? '—'}）`,
            ),
          )
        }
        // Per-day bar chart: the last 14 days of the window (2×7 grid reads
        // better in the card than 30+ hairlines). Zero days still render as a
        // 2px baseline so gaps stay honest.
        const CHART_DAYS = 14
        const chartRows = rows.slice(-CHART_DAYS)
        const max = chartRows.reduce((m, row) => Math.max(m, row.value), 0)
        items.push(
          h(
            'div',
            {
              key: 'usage-chart',
              style: {
                marginTop: '10px',
                display: 'grid',
                gridTemplateColumns: `repeat(${chartRows.length}, 1fr)`,
                gap: '3px',
                alignItems: 'end',
                height: '72px',
                padding: '4px 2px',
                border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                borderRadius: '10px',
              },
            },
            ...chartRows.map((row) => {
              const height = row.value <= 0 ? 2 : Math.max(6, Math.round((row.value / (max || 1)) * 64))
              const d = `${Number(row.date.slice(8, 10))}日`
              return h(
                'div',
                {
                  key: `bar-${row.date}`,
                  title: `${row.date}：${fmt(row.value)} ${unit}`,
                  style: {
                    alignSelf: 'end',
                    height: `${height}px`,
                    borderRadius: '2px 2px 0 0',
                    background: row.value > 0 ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
                    opacity: row.value > 0 ? 0.85 : 0.5,
                  },
                },
                h(
                  'span',
                  { style: { display: 'none' } },
                  d,
                ),
              )
            }),
          ),
        )
        items.push(
          h(
            'div',
            {
              key: 'usage-chart-axis',
              style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', opacity: 0.55, marginTop: '2px' },
            },
            h('span', null, chartRows.length > 0 ? chartRows[0].date.slice(5) : ''),
            h('span', null, `最近 ${chartRows.length} 天（${unit}）`),
            h('span', null, chartRows.length > 0 ? chartRows[chartRows.length - 1].date.slice(5) : ''),
          ),
        )
        return items
      }

      // ------------------------------------------------------------------
      // Tab bar (t16): CodeBuddy-style underline highlight. Text buttons in
      // a row; the active tab gets brand colour + a 2px underline on the
      // track, inactive tabs stay muted with a transparent underline.
      // ------------------------------------------------------------------
      const TABS = [
        { id: 'status', label: '账号管理' },
        { id: 'models', label: '可选模型' },
        { id: 'usage', label: '用量统计' },
      ]
      const active = TABS.some((tab) => tab.id === activeTab) ? activeTab : 'status'
      const tabBar = h(
        'div',
        {
          key: 'tab-bar',
          style: {
            display: 'flex',
            gap: '4px',
            borderBottom: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
            marginBottom: '10px',
          },
        },
        ...TABS.map((tab) => {
          const isActive = tab.id === active
          return h(
            'button',
            {
              key: `tab-${tab.id}`,
              onClick: () => setActiveTab(tab.id),
              style: {
                appearance: 'none',
                font: 'inherit',
                fontSize: '13px',
                fontWeight: isActive ? 600 : 400,
                color: isActive
                  ? 'var(--dsw-alias-brand-primary, #4d6bfe)'
                  : 'inherit',
                opacity: isActive ? 1 : 0.65,
                background: 'transparent',
                border: '0',
                borderBottom: isActive
                  ? '2px solid var(--dsw-alias-brand-primary, #4d6bfe)'
                  : '2px solid transparent',
                padding: '6px 10px',
                cursor: 'pointer',
                transition: 'color 0.12s, border-color 0.12s, opacity 0.12s',
              },
            },
            tab.label,
          )
        }),
      )

      const tabContent =
        active === 'models' ? buildModelsTab() : active === 'usage' ? buildUsageTab() : buildStatusTab()

      // ------------------------------------------------------------------
      // Account actions row: sits directly under the Qoder card title and
      // above the tab bar (screenshot layout: "网页登录添加账号" + "刷新").
      // ------------------------------------------------------------------
      const loginLabel =
        loginState.state === 'pending'
          ? '等待登录…'
          : status.signed_in
            ? '重新登录（设备码）'
            : '网页登录添加账号'
      const ghostButton = (label, onClick, extra = {}) =>
        h(
          'button',
          {
            onClick,
            style: {
              appearance: 'none',
              font: 'inherit',
              fontSize: '13px',
              lineHeight: 1.5,
              padding: '5px 14px',
              borderRadius: '8px',
              border: '0.5px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.4))',
              background: 'var(--dsw-alias-bg-layer-3, transparent)',
              color: 'inherit',
              cursor: busy ? 'default' : 'pointer',
              opacity: busy ? 0.55 : 1,
              transition: 'opacity 0.12s, background 0.12s',
              ...extra,
            },
          },
          label,
        )
      const accountActions = h(
        'div',
        {
          key: 'account-actions',
          style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' },
        },
        // Primary: brand solid, matching the CodeBuddy "扫码登录添加账号"
        // visual weight at the same slot.
        h(
          'button',
          {
            onClick: () => void beginLogin(),
            disabled: loginBusy || loginState.state === 'pending',
            style: {
              appearance: 'none',
              font: 'inherit',
              fontSize: '13px',
              lineHeight: 1.5,
              padding: '5px 14px',
              borderRadius: '8px',
              border: '1px solid transparent',
              background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
              color: 'var(--dsw-alias-label-primary-foreground, #fff)',
              cursor: loginBusy || loginState.state === 'pending' ? 'default' : 'pointer',
              opacity: loginBusy || loginState.state === 'pending' ? 0.55 : 1,
              transition: 'opacity 0.12s',
            },
          },
          loginLabel,
        ),
        // Refresh: re-reads the account data via the existing load().
        ghostButton('刷新', () => void load()),
        h(
          'span',
          { style: { fontSize: '12px', opacity: 0.6 } },
          '切换或删除通过设备码登录添加的 Qoder 账号。',
        ),
      )
      const loginFeedback = [
        loginUrl && loginState.state === 'pending'
          ? h(
              'div',
              { key: 'login-url', style: { marginBottom: '10px', fontSize: '12px', wordBreak: 'break-all' } },
              h('span', { style: { opacity: 0.6 } }, '登录链接：'),
              h('a', { href: loginUrl, target: '_blank', rel: 'noopener noreferrer' }, loginUrl),
            )
          : null,
        loginState.state === 'error'
          ? h(
              'div',
              { key: 'login-error', style: { marginBottom: '10px', fontSize: '12px', color: 'var(--dsw-alias-state-error-primary, #c33)' } },
              `登录失败：${loginState.error ?? '未知错误'}`,
            )
          : null,
      ].filter(Boolean)

      return h(
        'div',
        { style: { padding: '4px 0' } },
        accountActions,
        ...loginFeedback,
        tabBar,
        h('div', { key: 'tab-content' }, ...tabContent),
      )
    }

    /**
     * Expandable card wrapper (CodeBuddy-style): a full-width header button
     * with title + description + chevron, and the body only when open.
     */
    function QoderPluginCard() {
      const [open, setOpen] = react.useState(false)
      const chevron = h(
        'span',
        {
          style: {
            display: 'inline-block',
            transition: 'transform 0.16s',
            transform: open ? 'rotate(180deg)' : 'none',
            opacity: 0.6,
          },
        },
        '▾',
      )
      return h(
        'div',
        {
          style: {
            border: '0.5px solid var(--dsw-alias-border-l3, rgba(128,128,128,0.35))',
            borderRadius: '12px',
            padding: '2px',
            margin: '8px 0',
          },
        },
        h(
          'button',
          {
            onClick: () => setOpen((value) => !value),
            style: {
              appearance: 'none',
              width: '100%',
              font: 'inherit',
              color: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
              background: 'transparent',
              border: '0',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
            },
          },
          h(
            'span',
            { style: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 } },
            h('span', { style: { fontSize: '14px', fontWeight: 600 } }, 'Qoder'),
            h(
              'span',
              { style: { fontSize: '12px', opacity: 0.6 } },
              '使用 Qoder 设备码登录，并选择模型选择器中要提供的模型。',
            ),
          ),
          chevron,
        ),
        open ? h('div', { style: { padding: '4px 14px 12px' } }, h(QoderPluginCardBody)) : null,
      )
    }

    /** Stable browser-plugin name. */
    const name = 'dsh-qoder-cli-client'

    /** Client services required for the settings contribution. */
    const inject = ['slots', 'locale']

    function apply(ctx) {
      try {
        ctx.slots.inject('settings.plugin.item', () =>
          ctx.slots.register(
            {
              name: 'settings.plugin.item',
              key: 'qoder-cli',
              priority: 31,
            },
            QoderPluginCard,
          ),
        )
      } catch (error) {
        console.error(
          '[dsh-qoder-cli] client card failed to load (host provider unaffected):',
          error,
        )
      }
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
