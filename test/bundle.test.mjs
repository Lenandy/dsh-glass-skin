/**
 * Verifies the real client bundle (`lib/client.js`) against a stubbed DOM and
 * theme service — the same contract the shell provides.
 *
 * This is not a rendering test: it pins the bundle's *contract*, which is what
 * can silently break a UI. Specifically that `apply()` never throws, that it
 * injects exactly one stylesheet and one backdrop node, that the glass does not
 * depend on the theme service alone, that it hands that service a well-formed
 * override layer, and that the control surface behaves.
 *
 *   node test/bundle.test.mjs
 */
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import assert from 'node:assert/strict'

const CLIENT_SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const BACKDROP_SELECTOR = 'div[data-dsh-glass-skin-backdrop]'

/** A DOM small enough to reason about, faithful on the points the bundle uses. */
function makeDom() {
  const styles = []
  const attributes = new Map()
  const rootVars = new Map()
  const inserted = []

  const documentElement = {
    style: {
      setProperty: (name, value) => rootVars.set(name, value),
      removeProperty: (name) => rootVars.delete(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
  }

  const bodyAttributes = new Map()
  const body = {
    style: { setProperty() {}, removeProperty() {} },
    firstChild: null,
    insertBefore(node) {
      inserted.push(node)
      return node
    },
    appendChild(node) {
      inserted.push(node)
      return node
    },
    // `<body>` is where the presenter publishes the active colour scheme, so the
    // stub has to carry attributes for the per-scheme behaviour to be testable.
    setAttribute(name, value) {
      bodyAttributes.set(name, value)
    },
    getAttribute(name) {
      return bodyAttributes.has(name) ? bodyAttributes.get(name) : null
    },
    removeAttribute(name) {
      bodyAttributes.delete(name)
    },
  }

  const document = {
    documentElement,
    body,
    head: {
      appendChild(node) {
        styles.push(node)
      },
    },
    createElement(tag) {
      return {
        tagName: String(tag === undefined ? 'div' : tag).toUpperCase(),
        dataset: {},
        style: {},
        textContent: '',
        id: '',
        // A real form control always has a string value; keep the stub faithful.
        value: '',
        children: [],
        appendChild(node) {
          this.children.push(node)
          return node
        },
        // Record listeners so a test can drive a click the way a user would.
        addEventListener(type, handler) {
          this._handlers = this._handlers === undefined ? {} : this._handlers
          this._handlers[type] = handler
        },
        fire(type, event) {
          if (this._handlers === undefined) return
          const handler = this._handlers[type]
          if (handler === undefined) return
          handler(event === undefined
            ? { stopPropagation() {}, preventDefault() {} }
            : event)
        },
        remove() {},
        setAttribute(name, value) {
          this[name] = value
        },
        getAttribute(name) {
          return this[name] ?? null
        },
        getBoundingClientRect() {
          return { width: 0, height: 0, top: 0, left: 0 }
        },
      }
    },
    querySelector(selector) {
      // The idempotency guard for the stylesheet.
      if (selector.includes('data-plugin-css')) return styles.length > 0 ? styles[0] : null
      // Attribute-addressed body nodes (backdrop, chip) — match on the exact
      // attribute, the way a real attribute selector would.
      const attribute = /\[(data-dsh-glass-skin-[a-z-]+)\]/.exec(selector)
      if (attribute !== null) {
        return inserted.find((node) => node.getAttribute(attribute[1]) !== null) ?? null
      }
      return null
    },
    querySelectorAll(selector) {
      return selector === 'style[data-plugin-css]' ? styles.slice() : []
    },
    getElementById() {
      return null
    },
  }

  return { document, styles, attributes, rootVars, inserted, bodyAttributes }
}

function makeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  }
}

/** Load the bundle in a fresh realm and hand back its registration. */
function loadBundle(options = {}) {
  const { document, styles, attributes, rootVars, inserted, bodyAttributes } = makeDom()
  const localStorage = makeStorage()
  const warnings = []
  const errors = []
  const timers = []

  // The client module loader the shell installs before any bundle runs.
  const windowObject = {
    __ModuleLoader__: {
      load(definition) {
        windowObject.__glassDefinition = definition
      },
    },
  }

  const sandbox = {
    window: windowObject,
    document,
    localStorage,
    // Captured, never auto-run: the deferred self-check is exercised explicitly.
    setTimeout(callback) {
      timers.push(callback)
      return timers.length
    },
    console: {
      log: () => {},
      warn: (message) => warnings.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
  }

  // Only stubbed when a test needs to drive the picture probe: with no `Image`
  // the bundle applies a wallpaper unverified, which is what the other tests
  // assume. `imageOk` decides synchronously which addresses resolve.
  if (options.imageOk !== undefined) {
    sandbox.URL = URL
    sandbox.Image = function Image() {
      const self = this
      this.onload = null
      this.onerror = null
      Object.defineProperty(this, 'src', {
        get() {
          return self._src
        },
        set(value) {
          self._src = value
          if (options.imageOk.test(value)) {
            if (typeof self.onload === 'function') self.onload()
          } else if (typeof self.onerror === 'function') {
            self.onerror()
          }
        },
      })
    }
  }
  sandbox.globalThis = sandbox
  const context = createContext(sandbox)
  runInContext(CLIENT_SOURCE, context, { filename: 'client.js' })

  const definition = windowObject.__glassDefinition
  assert.ok(definition, 'bundle must call window.__ModuleLoader__.load')
  assert.equal(definition.id, 'dsh-glass-skin')

  const mod = definition.factory(() => {
    throw new Error('the preview/dsh module table should not be needed')
  })

  return { mod, styles, attributes, rootVars, inserted, bodyAttributes, timers, localStorage, warnings, errors, sandbox, windowObject }
}

/** A theme service stub that records every call the bundle makes. */
function makeTheme(scheme = 'dark') {
  const calls = { overrideTokens: [], setTheme: [], disposeCalls: 0 }
  const theme = {
    getTheme: () => ({
      preference: scheme,
      fontSize: 14,
      revision: 1,
      active: { id: scheme, colorScheme: scheme, tokens: {} },
      themes: [],
    }),
    setTheme: (id) => calls.setTheme.push(id),
    setFontSize: () => {},
    register: () => () => {},
    overrideTokens: (source, pairs) => {
      calls.overrideTokens.push({ source, pairs })
      return () => calls.disposeCalls++
    },
    _calls: calls,
  }
  return theme
}

// ---------------------------------------------------------------- contract ---

{
  const { mod } = loadBundle()
  assert.equal(mod.name, 'dsh-glass-skin')
  // Spread first: values built inside the vm realm have a different
  // Array.prototype, which deepStrictEqual treats as a mismatch.
  assert.deepEqual([...mod.inject], ['theme'])
  assert.equal(typeof mod.apply, 'function')
}

// ------------------------------------------------------------- stylesheet ---

{
  const { mod, styles, inserted } = loadBundle()
  mod.apply({ theme: makeTheme() })

  assert.equal(styles.length, 1, 'exactly one stylesheet')
  const css = styles[0].textContent
  assert.equal(styles[0].dataset.plugin, 'dsh-glass-skin')

  for (const fragment of [
    'html, body { background-color: transparent',
    '#root { background: transparent',
    `div[data-dsh-glass-skin-backdrop]`,
    `div[data-dsh-glass-skin-backdrop]::after`,
    '--dsh-glass-skin-photo',
    '--dsh-glass-skin-blur',
    '--dsh-glass-skin-wash',
    'data-dsh-glass-skin="off"',
  ]) {
    assert.ok(css.includes(fragment), `css should contain: ${fragment}`)
  }

  // A picture must layer OVER the gradient, never replace it: a background
  // whose image fails to load paints nothing, and glass over nothing is black.
  assert.ok(
    css.includes('background-image: var(--dsh-glass-skin-photo, none), var(--dsh-glass-skin-backdrop-default'),
    'the photo must sit on top of the built-in gradient',
  )

  // No hashed CSS-module class names: an upgrade must not be able to break it.
  assert.ok(!/\.\w{5,8}_\w/.test(css), 'css must not depend on hashed module classes')

  // The backdrop is a real node, inserted once, not a pseudo-element. The chip
  // is the second body-level node and doubles as the "did my code load at all"
  // signal — a hotkey cannot serve that role on Desktop.
  const backdrops = inserted.filter((node) => node.getAttribute('data-dsh-glass-skin-backdrop') !== null)
  const chips = inserted.filter((node) => node.getAttribute('data-dsh-glass-skin-chip') !== null)
  assert.equal(backdrops.length, 1, 'exactly one backdrop node')
  assert.equal(chips.length, 1, 'exactly one chip node')
  // An icon button: no visible label, but the words live in aria-label, and the
  // material has to be the frosted circle the design asks for.
  assert.notEqual(chips[0].textContent, '玻璃', 'the button carries no text label')
  assert.equal(chips[0].getAttribute('aria-label'), 'dsh-glass-skin 控制台')
  assert.equal(chips[0].getAttribute('role'), 'button')
  assert.ok(chips[0].style.cssText.includes('border-radius:50%'), 'it is a circle')
  assert.ok(chips[0].style.cssText.includes('backdrop-filter'), 'frosted material')

  // v0.1 shipped only `body::before`; that is what failed in the field.
  assert.ok(!css.includes('body::before'), 'the pseudo-element backdrop must be gone')

  // A mid-edit stylesheet interpolated `undefined` and reached a real user, then
  // stayed pinned in the page because the tag was never refreshed. Both halves
  // are pinned here.
  assert.ok(!css.includes('undefined'), 'the stylesheet must have no unresolved interpolation')
}

{
  // HMR re-materializes the module while its first stylesheet is still in the
  // document: the id guard must refresh the content, not freeze the page on the
  // first CSS it ever saw.
  const bundle = loadBundle()
  const stale = { dataset: {}, style: {}, textContent: 'stale-sheet' }
  bundle.styles.push(stale)

  bundle.mod.apply({ theme: makeTheme() })

  assert.equal(bundle.styles.length, 1, 'the existing tag must be reused, not duplicated')
  assert.notEqual(stale.textContent, 'stale-sheet', 'the tag content must be refreshed')
  assert.ok(stale.textContent.includes('--dsh-glass-skin-backdrop'))
  assert.ok(!stale.textContent.includes('undefined'))
}

// ------------------------------------------------- the glass is self-carried ---

{
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const text = bundle.styles[0].textContent

  // Forced from CSS, so the skin does not depend on the theme service path.
  // The adjustable surfaces are published through a variable (so the console's
  // 浓度 slider is live) with the shipped value as the per-scheme fallback.
  const forcedDark = '--dsw-alias-bg-base: var(--dsh-glass-skin-canvas, rgba(16,19,25,.17)) !important'
  const forcedLight = '--dsw-alias-bg-base: var(--dsh-glass-skin-canvas, rgba(255,255,255,.15)) !important'
  assert.equal(text.split(forcedDark).length - 1, 1, 'one dark declaration')
  assert.equal(text.split(forcedLight).length - 1, 1, 'one light declaration')
  // Popovers stay literal: they are painted once and must remain readable.
  assert.ok(text.includes('--dsw-specific-menu: rgba(26,30,37,.66) !important'))

  // Gated on the flag, so `off` really restores the product palette: an inline
  // value can never beat !important, so an ungated rule would be a one-way door.
  const gate = 'html:not([data-dsh-glass-skin="off"])'
  assert.ok(text.includes(gate), 'the forced tokens must be gated')
  assert.ok(
    text.indexOf(gate) < text.indexOf(forcedDark),
    'the gate must precede the forced declarations',
  )

  // Gated on the active scheme too, which the presenter publishes as
  // `body[data-ds-dark-theme]`. v0.3 used one dark value for both schemes and
  // left a light-mode user with dark glass under light labels.
  assert.ok(text.includes('body[data-ds-dark-theme]'), 'the forced tokens must be scheme-gated')
  assert.ok(text.includes('--dsh-glass-skin-backdrop-default'), 'the backdrop follows the scheme')
  assert.ok(text.includes('--dsh-glass-skin-wash-default'), 'the wash follows the scheme')
}

{
  const { mod, styles, inserted } = loadBundle()
  const theme = makeTheme()
  mod.apply({ theme })
  mod.apply({ theme })
  assert.equal(styles.length, 1, 'a second apply must not inject a second tag')
  assert.equal(
    inserted.filter((node) => node.getAttribute('data-dsh-glass-skin-backdrop') !== null).length,
    1,
    'a second apply must not insert a second backdrop',
  )
  assert.equal(
    inserted.filter((node) => node.getAttribute('data-dsh-glass-skin-chip') !== null).length,
    1,
    'a second apply must not insert a second chip',
  )
}

// ---------------------------------------------------------- token override ---

{
  const { mod } = loadBundle()
  const theme = makeTheme('dark')
  mod.apply({ theme })

  assert.equal(theme._calls.overrideTokens.length, 1)
  const { source, pairs } = theme._calls.overrideTokens[0]
  assert.equal(source, 'dsh-glass-skin')

  const tokens = [...Object.keys(pairs)]
  assert.deepEqual(tokens.sort(), [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-overlay',
    '--dsw-specific-menu',
    '--dsw-specific-sidebar-fill',
  ])

  for (const token of tokens) {
    const pair = pairs[token]
    assert.deepEqual(
      [...Object.keys(pair)].sort(),
      ['dark', 'light'],
      `${token} must carry both schemes — a bare string throws at the real boundary`,
    )
    for (const value of [pair.light, pair.dark]) {
      assert.equal(typeof value, 'string')
      // The whole point: an alpha channel, so the backdrop shows through.
      assert.match(value, /^rgba\(/, `${token} must be translucent`)
    }
    // Each scheme needs its own value; one shared value is how light mode broke.
    assert.notEqual(pair.light, pair.dark, `${token} must differ between schemes`)
  }

  // Cards and bubbles must stay solid for readability.
  assert.ok(!('--dsw-alias-bg-layer-1' in pairs))
  assert.ok(!('--dsw-alias-bg-layer-2' in pairs))
}

// ---------------------------------------------------- colour-scheme safety ---

{
  // The skin follows the user's colour scheme and never changes it. v0.3 called
  // `setTheme('dark')` here, which silently left a light-mode user in a broken
  // dark UI — the worst bug this plugin has shipped, so it is pinned twice: the
  // preference must never be written, and both schemes must carry real values.
  for (const scheme of ['light', 'dark']) {
    const { mod } = loadBundle()
    const theme = makeTheme(scheme)
    mod.apply({ theme })
    assert.deepEqual(theme._calls.setTheme, [], `the skin must not switch the scheme (${scheme})`)
    assert.equal(theme._calls.overrideTokens.length, 1, 'the surface layer still applies')
  }
}

// ----------------------------------------------------------- control surface ---

{
  const globals = loadBundle()
  globals.mod.apply({ theme: makeTheme() })

  assert.equal(globals.attributes.get('data-dsh-glass-skin'), 'on')
  assert.equal(globals.rootVars.get('--dsh-glass-skin-on'), '1')

  const surface = globals.sandbox.window.__dshGlassSkin
  assert.ok(surface, 'window.__dshGlassSkin must exist')
  for (const method of ['off', 'on', 'wallpaper', 'blur', 'wash', 'reset', 'probe', 'diagnose', 'panel', 'layers', 'compositeAlpha', 'scaleAlpha', 'glass']) {
    assert.equal(typeof surface[method], 'function', `__dshGlassSkin.${method}`)
  }
  assert.equal(surface.version, 21)

  surface.off()
  assert.equal(globals.attributes.get('data-dsh-glass-skin'), 'off')
  assert.equal(globals.localStorage.getItem('dsh-glass-skin:on'), 'off')

  surface.on()
  assert.equal(globals.attributes.get('data-dsh-glass-skin'), 'on')

  surface.wallpaper('https://example.com/w.jpg')
  assert.equal(globals.rootVars.get('--dsh-glass-skin-photo'), 'url("https://example.com/w.jpg")')
  assert.equal(globals.localStorage.getItem('dsh-glass-skin:wallpaper'), 'https://example.com/w.jpg')

  surface.blur('88px')
  assert.equal(globals.rootVars.get('--dsh-glass-skin-blur'), '88px')

  surface.wash(0.5)
  assert.equal(globals.rootVars.get('--dsh-glass-skin-wash'), 'rgba(10,12,16,0.5)')

  surface.reset()
  assert.equal(globals.rootVars.has('--dsh-glass-skin-photo'), false)
  assert.equal(globals.rootVars.has('--dsh-glass-skin-blur'), false)
  assert.equal(globals.localStorage.getItem('dsh-glass-skin:on'), null)
}

// -------------------------------------------------------------------- probe ---

{
  const globals = loadBundle()
  globals.mod.apply({ theme: makeTheme() })
  const report = globals.sandbox.window.__dshGlassSkin.probe()

  assert.equal(report.plugin, 'dsh-glass-skin')
  assert.equal(report.version, 21)
  assert.equal(report.flag, 'on')
  assert.equal(typeof report.scheme, 'string', 'the probe must report the active scheme')
  assert.ok(Array.isArray(report.stylesheets))
  assert.ok(report.sky.exists, 'the probe must find the backdrop node')
  assert.equal(typeof report.paint, 'object')
  assert.equal(typeof report.tokens, 'object')
  // The stub has no getComputedStyle, so every computed read degrades to null
  // rather than throwing — that is the point.
  assert.equal(report.paint.body, null)
  assert.doesNotThrow(() => JSON.stringify(report), 'the probe must be JSON-safe')

  globals.sandbox.window.__dshGlassSkin.off()
  assert.equal(globals.sandbox.window.__dshGlassSkin.probe().flag, 'off')
}

// --------------------------------------------------------- self-report ---

{
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  assert.equal(bundle.timers.length, 1, 'apply must schedule exactly one self-check')

  const before = bundle.inserted.length
  bundle.timers[0]()
  assert.equal(bundle.inserted.length, before + 1, 'an unhealthy verdict renders the panel')
  assert.equal(bundle.errors.length, 0, 'the self-check must not report an error')
}

{
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const surface = bundle.sandbox.window.__dshGlassSkin

  const verdict = surface.diagnose()
  assert.equal(typeof verdict.ok, 'boolean')
  assert.ok(Array.isArray(verdict.reasons))
  assert.ok(verdict.reasons.length > 0, 'a DOM with no getComputedStyle cannot look healthy')
  assert.doesNotThrow(() => JSON.stringify(verdict), 'the verdict must be JSON-safe')

  // Panel control must be idempotent and safe in any state.
  assert.doesNotThrow(() => surface.panel(false))
  const rendered = surface.panel(true)
  assert.ok(rendered, 'the console must render')

  // The console is the user-facing control surface now: it must carry the
  // transparency-family sliders and still be closable with the mouse alone.
  const nodes = []
  const walk = (node) => {
    for (const child of node.children ?? []) {
      nodes.push(child)
      walk(child)
    }
  }
  walk(rendered)
  assert.equal(nodes.filter((node) => node.type === 'range').length, 3, 'sliders: 浓度 / 模糊 / 遮罩')
  assert.ok(nodes.some((node) => node.textContent === '\u00d7'), 'a mouse-operated close control')
  assert.ok(nodes.some((node) => node.tagName === 'PRE'), 'the details report is still reachable')

  // A filesystem path cannot be a CSS url(), so a local picture has to come
  // through the browser's own file picker.
  const pickers = nodes.filter((node) => node.type === 'file')
  assert.equal(pickers.length, 1, 'one file input for local pictures')
  assert.equal(pickers[0].accept, 'image/*')
  assert.ok(
    nodes.some((node) => node.tagName === 'BUTTON'
      && String(node.getAttribute('aria-label')).includes('本机选')),
    'the picker has a button, labelled by its tooltip',
  )

  assert.doesNotThrow(() => surface.panel(false))
  assert.equal(bundle.errors.length, 0)
}

{
  // The 浓度 slider is alpha arithmetic; get it wrong and the glass either
  // vanishes or goes solid.
  const bundle = loadBundle()
  const theme = makeTheme()
  bundle.mod.apply({ theme })
  const api = bundle.sandbox.window.__dshGlassSkin

  assert.equal(api.scaleAlpha('rgba(16,19,25,.20)', 1), 'rgba(16,19,25,0.2)')
  assert.equal(api.scaleAlpha('rgba(16,19,25,.20)', 2), 'rgba(16,19,25,0.4)')
  assert.equal(api.scaleAlpha('rgba(16,19,25,.20)', 0), 'rgba(16,19,25,0)')
  assert.equal(api.scaleAlpha('rgba(16,19,25,.20)', 99), 'rgba(16,19,25,1)', 'alpha is clamped')
  assert.equal(api.scaleAlpha('rgb(1,2,3)', 0.5), 'rgba(1,2,3,0.5)')
  assert.equal(api.scaleAlpha('not-a-colour', 2), 'not-a-colour')

  const before = theme._calls.overrideTokens.length
  api.glass(0.5)
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass:light'), '0.5', 'stored per scheme')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass'), null, 'the legacy key is not rewritten')
  // The stub DOM reports the light scheme, so the published surface is the
  // light base alpha halved.
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-canvas'), 'rgba(255,255,255,0.075)')
  assert.ok(theme._calls.overrideTokens.length > before, 'the token layer is restacked on change')
}

{
  // Light and dark must not share one setting, and the veil must follow the
  // scheme — a black veil over a light UI is what made light mode look dirty.
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  // Light: white veil, white glass.
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-wash'), 'rgba(255,255,255,0.2)')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-canvas'), 'rgba(255,255,255,0.15)')

  // Flip to dark the way the presenter does, then re-publish.
  bundle.bodyAttributes.set('data-ds-dark-theme', '')
  api.glass(1)
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-wash'), 'rgba(10,12,16,0.28)', 'dark veil darkens')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-canvas'), 'rgba(16,19,25,0.17)')

  // A strength set in one scheme must not leak into the other.
  api.glass(0.5)
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass:dark'), '0.5')
  bundle.bodyAttributes.delete('data-ds-dark-theme')
  api.glass(1)
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass:light'), '1')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass:dark'), '0.5', 'dark keeps its own value')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-wash'), 'rgba(255,255,255,0.2)', 'back to the light veil')
}

{
  // The layer report is what separates "the skin declared the wrong thing" from
  // "something else paints over it". It must survive a DOM with no hit testing.
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const report = bundle.sandbox.window.__dshGlassSkin.layers()

  assert.ok(Array.isArray(report.fromRoot))
  assert.equal(report.atCentre, null, 'no elementFromPoint in this stub')
  assert.equal(report.underRoot, null)
  assert.equal(report.composite, null, 'no chain means no composite to report')
  assert.equal(report.inShadow, false)
  assert.doesNotThrow(() => JSON.stringify(report), 'the layer report must be JSON-safe')
}

{
  // The arithmetic this plugin got wrong for seven versions: fills that each
  // look "translucent" composite to nearly opaque, and the report showed only
  // the per-token values, so nothing ever flagged it.
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const compositeAlpha = bundle.sandbox.window.__dshGlassSkin.compositeAlpha

  // What shipped through v7 on Windows: frame fill over the centre column.
  assert.equal(compositeAlpha(['rgba(11,14,18,0.62)', 'rgba(16,19,25,0.55)']), 0.829)
  // What v8 ships: real glass.
  assert.equal(compositeAlpha(['rgba(11,14,18,0.34)', 'rgba(16,19,25,0.20)']), 0.472)
  // The sidebar stacks the same fill with itself.
  assert.equal(compositeAlpha(['rgba(11,14,18,0.34)', 'rgba(11,14,18,0.34)']), 0.564)
  // Opaque and unparsable inputs must not skew it, and nothing may throw.
  assert.equal(compositeAlpha(['rgb(1,2,3)']), 1)
  assert.equal(compositeAlpha([]), 0)
  assert.equal(compositeAlpha(['nonsense']), 0)

  // And the shipped values must stay under the self-check's own threshold, so
  // the diagnostic cannot fire on the skin's own defaults.
  const tokens = bundle.sandbox.window.__dshGlassSkin.tokens
  for (const scheme of ['light', 'dark']) {
    const sidebar = tokens['--dsw-specific-sidebar-fill'][scheme]
    const canvas = tokens['--dsw-alias-bg-base'][scheme]

    // The REAL stack is three deep over the conversation (frame + centre column
    // + view root) and two deep over the sidebar. Calibrating against a pair is
    // exactly how the shipped glass ended up ~69% opaque while looking correct
    // on paper — so the guard models the true depth.
    const canvasStack = compositeAlpha([sidebar, canvas, canvas])
    const sidebarStack = compositeAlpha([sidebar, sidebar])

    assert.ok(canvasStack < 0.7, `canvas stack too opaque (${scheme}): ${canvasStack}`)
    assert.ok(sidebarStack < 0.85, `sidebar stack too opaque (${scheme}): ${sidebarStack}`)
    assert.ok(
      sidebarStack > canvasStack,
      `chrome must read deeper than the canvas (${scheme}): ${sidebarStack} vs ${canvasStack}`,
    )
  }
}

{
  // Deliberately off is not a failure: no reasons, no panel.
  const bundle = loadBundle()
  bundle.localStorage.setItem('dsh-glass-skin:on', 'off')
  bundle.mod.apply({ theme: makeTheme() })

  const verdict = bundle.sandbox.window.__dshGlassSkin.diagnose()
  assert.equal(verdict.ok, true, 'an intentional off state must not read as broken')
  assert.equal(verdict.off, true)
  assert.deepEqual([...verdict.reasons], [])

  const before = bundle.inserted.length
  bundle.timers[0]()
  assert.equal(bundle.inserted.length, before, 'no panel while deliberately off')
}

// ----------------------------------------------------- stored preferences ---

{
  // off(false) must switch off without persisting: the preview harness relies on
  // it, and a persisted "off" is invisible and sticky.
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  bundle.sandbox.window.__dshGlassSkin.off(false)
  assert.equal(bundle.attributes.get('data-dsh-glass-skin'), 'off')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:on'), null, 'off(false) must not persist')

  const bundle2 = loadBundle()
  bundle2.mod.apply({ theme: makeTheme() })
  bundle2.sandbox.window.__dshGlassSkin.on(false)
  assert.equal(bundle2.attributes.get('data-dsh-glass-skin'), 'on')
  assert.equal(bundle2.localStorage.getItem('dsh-glass-skin:on'), null, 'on(false) must not persist')
}

{
  const bundle = loadBundle()
  bundle.localStorage.setItem('dsh-glass-skin:wallpaper', 'https://example.com/a.png')
  bundle.localStorage.setItem('dsh-glass-skin:blur', '20px')
  bundle.localStorage.setItem('dsh-glass-skin:wash', '0.8')
  bundle.mod.apply({ theme: makeTheme() })

  assert.equal(bundle.rootVars.get('--dsh-glass-skin-photo'), 'url("https://example.com/a.png")')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-blur'), '20px')
  assert.equal(
    bundle.rootVars.get('--dsh-glass-skin-wash'),
    'rgba(255,255,255,0.8)',
    'the stored strength is applied in the light scheme as a light veil',
  )
}

{
  const bundle = loadBundle()
  bundle.localStorage.setItem('dsh-glass-skin:on', 'off')
  bundle.mod.apply({ theme: makeTheme() })
  assert.equal(bundle.attributes.get('data-dsh-glass-skin'), 'off')
}

// ------------------------------------------------------------ degradation ---

{
  // No theme service at all: backdrop and stylesheet still land, loud but harmless.
  const { mod, errors, warnings, styles, inserted } = loadBundle()
  mod.apply({})
  assert.equal(styles.length, 1, 'the stylesheet still lands')
  assert.equal(
    inserted.filter((node) => node.getAttribute('data-dsh-glass-skin-backdrop') !== null).length,
    1,
    'the backdrop still lands',
  )
  assert.equal(errors.length, 0, 'must not report an error')
  assert.ok(warnings.some((w) => w.includes('theme service unavailable')))
}

{
  // A theme service that throws on every call must not take the UI down.
  const { mod, errors } = loadBundle()
  const hostile = {
    getTheme() { throw new Error('boom') },
    setTheme() { throw new Error('boom') },
    register() { throw new Error('boom') },
    overrideTokens() { throw new Error('boom') },
  }
  mod.apply({ theme: hostile })
  assert.equal(errors.length, 0, 'a hostile theme service must not produce an error report')
}

{
  // A context with nothing on it at all.
  const { mod, errors } = loadBundle()
  mod.apply(undefined)
  mod.apply(null)
  mod.apply(42)
  assert.equal(errors.length, 0)
}

// ------------------------------------------------------------ wallpaper ---

{
  // A wallpaper must never be able to blank the backdrop: it layers over the
  // built-in gradient, quotes cannot break out of the url() token, and an empty
  // value goes back to the built-in backdrop.
  const bundle = loadBundle()
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  api.wallpaper('https://example.com/a.png')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-photo'), 'url("https://example.com/a.png")')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), 'https://example.com/a.png')

  api.wallpaper('https://example.com/a"b.png')
  assert.equal(
    bundle.rootVars.get('--dsh-glass-skin-photo'),
    'url("https://example.com/a\\"b.png")',
    'a quote must be escaped, not break the declaration',
  )

  api.wallpaper('')
  assert.equal(bundle.rootVars.has('--dsh-glass-skin-photo'), false, 'empty clears the picture')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), null)
}

{
  // A picture address copied from a search-results page is HTML, not a picture;
  // the real address rides in its `mediaurl` parameter. Pasting the link has to
  // work, because that is what a person actually copies.
  const PAGE = 'https://search.example/images?view=detailV2&mediaurl='
    + encodeURIComponent('https://imgs.example/pic.jpg') + '&q=test'
  const bundle = loadBundle({ imageOk: /^https:\/\/imgs\.example\// })
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  assert.equal(bundle.rootVars.has('--dsh-glass-skin-photo'), false, 'nothing applied yet')
  api.wallpaper(PAGE)
  assert.equal(
    bundle.rootVars.get('--dsh-glass-skin-photo'),
    'url("https://imgs.example/pic.jpg")',
    'the embedded picture address must be used',
  )
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), 'https://imgs.example/pic.jpg')
}

{
  // A link with no picture inside, and no picture itself: fail clean and keep
  // the built-in backdrop. A reachable picture still applies directly.
  const bundle = loadBundle({ imageOk: /^https:\/\/imgs\.example\// })
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  api.wallpaper('https://search.example/images?q=test')
  assert.equal(bundle.rootVars.has('--dsh-glass-skin-photo'), false, 'nothing painted on failure')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), null)

  api.wallpaper('https://imgs.example/other.jpg')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-photo'), 'url("https://imgs.example/other.jpg")')
}

{
  // A link carrying a data URL is extracted too — which keeps the self-check
  // page able to prove this path without any network access.
  const bundle = loadBundle({ imageOk: /^data:image\// })
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  api.wallpaper('https://search.example/images?mediaurl='
    + encodeURIComponent('data:image/gif;base64,R0lGODlhAQABAAAAACw='))
  assert.equal(
    bundle.rootVars.get('--dsh-glass-skin-photo'),
    'url("data:image/gif;base64,R0lGODlhAQABAAAAACw=")',
    'a data URL carried by a link is extracted too',
  )
}

// ------------------------------------------------- wallpaper buttons ---

{
  // Three actions, three buttons, three glyphs — and crucially the apply button
  // no longer doubles as "clear" when the field is empty.
  const bundle = loadBundle({ imageOk: /^https:\/\/imgs\.example\// })
  bundle.mod.apply({ theme: makeTheme() })
  const api = bundle.sandbox.window.__dshGlassSkin

  const nodes = []
  ;(function walk(node) {
    for (const child of node.children ?? []) {
      nodes.push(child)
      walk(child)
    }
  })(api.panel(true))

  const byLabel = (text) => nodes.find((node) => typeof node.getAttribute === 'function'
    && String(node.getAttribute('aria-label')).includes(text))

  const use = byLabel('用这个地址')
  const clear = byLabel('清除壁纸')
  const pick = byLabel('本机选')
  assert.ok(use, 'an apply button, labelled by its tooltip')
  assert.ok(clear, 'a clear button of its own')
  assert.ok(pick, 'a local-picture button')
  assert.equal(use.textContent, '', 'the apply button carries a glyph, not a word')
  assert.equal(clear.textContent, '', 'the clear button carries a glyph, not a word')

  // An empty field must apply nothing at all.
  use.fire('click')
  assert.equal(bundle.rootVars.has('--dsh-glass-skin-photo'), false, 'empty field applies nothing')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), null)

  // A reachable address applies.
  const input = nodes.find((node) => node.tagName === 'INPUT' && node.type === 'text')
  input.value = 'https://imgs.example/pic.jpg'
  use.fire('click')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-photo'), 'url("https://imgs.example/pic.jpg")')

  // The dedicated clear button goes back to the built-in backdrop.
  clear.fire('click')
  assert.equal(bundle.rootVars.has('--dsh-glass-skin-photo'), false)
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wallpaper'), null)

  // The global reset is a separate, labelled control.
  const reset = byLabel('恢复全部默认设置')
  assert.ok(reset, 'resetting everything is its own control, and says so')
}

// ------------------------------------------- colour-scheme switch restack ---

{
  // Switching scheme makes the presenter re-publish its own token map, which
  // REPLACES the layer we registered — and it publishes those tokens as
  // important inline declarations, so no stylesheet can win them back. Without a
  // fresh overrideTokens the four surface tokens go opaque and stay opaque until
  // something else restacks. On a real install that was "1 layer, 100%" that
  // only a preset click cleared.
  const bundle = loadBundle()
  const theme = makeTheme()
  const handlers = {}
  bundle.mod.apply({
    theme,
    get: (name) => (name === 'theme' ? theme : undefined),
    on: (event, handler) => { handlers[event] = handler },
  })

  assert.equal(typeof handlers['theme/change'], 'function', 'the skin listens for a scheme change')

  const before = theme._calls.overrideTokens.length
  handlers['theme/change']()
  assert.ok(
    theme._calls.overrideTokens.length > before,
    'a scheme change must restack the token layer, not just rewrite the CSS vars',
  )
}

// ------------------------------------------------------- legacy migration ---

{
  // Renaming the plugin changed the settings namespace. Anything saved under the
  // old one must be carried over: every preference lives under `<namespace>:…`,
  // so a rename would otherwise silently reset a user's whole tuning — including
  // the separately stored light and dark strengths.
  const bundle = loadBundle()
  bundle.localStorage.setItem('dsh-glass:on', 'on')
  bundle.localStorage.setItem('dsh-glass:blur', '96px')
  bundle.localStorage.setItem('dsh-glass:glass:dark', '1.4')
  bundle.localStorage.setItem('dsh-glass:wash:light', '0.33')

  bundle.mod.apply({ theme: makeTheme() })

  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:blur'), '96px')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:glass:dark'), '1.4')
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:wash:light'), '0.33')
  assert.equal(
    bundle.rootVars.get('--dsh-glass-skin-blur'),
    '96px',
    'a carried-over value is applied, not just copied',
  )
  assert.equal(bundle.attributes.get('data-dsh-glass-skin'), 'on')

  // And it runs once: a newer value must never be clobbered by the stale one.
  bundle.localStorage.setItem('dsh-glass-skin:blur', '30px')
  bundle.mod.apply({ theme: makeTheme() })
  assert.equal(bundle.localStorage.getItem('dsh-glass-skin:blur'), '30px', 'the migration runs once')
  assert.equal(bundle.rootVars.get('--dsh-glass-skin-blur'), '30px')
}

console.log('dsh-glass-skin: client bundle contract OK')
