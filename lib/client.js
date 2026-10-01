/**
 * dsh-glass-skin — acrylic-style glass skin for the DSH web UI (browser half).
 *
 * What it does, and why it is built this way
 * -----------------------------------------
 * The target look is a Windows-Terminal-style acrylic window: a blurred,
 * blue-grey desktop behind translucent chrome. In a browser the CSS
 * `backdrop-filter` can only blur layers *inside the page* — it cannot reach
 * the real desktop behind the window — so this skin supplies the backdrop
 * itself (a heavily pre-blurred gradient, or a picture you hand it) and then
 * makes DSH's own surfaces translucent on top of it.
 *
 * Three levers:
 *
 *   1. The theme service (`ctx.theme.overrideTokens`) — the tidy path: give
 *      the four surface tokens an alpha channel.
 *   2. The same four tokens restated in the injected stylesheet with
 *      `!important`, gated on the published colour scheme. This is the
 *      *fallback* path, not the guaranteed one: the presenter publishes its
 *      tokens as important inline custom properties, and an inline important
 *      declaration outranks a stylesheet important one. It covers the window
 *      between a scheme switch and the re-registration in `restack()` — and
 *      v0.2 learned the hard way (scheme switch → 1 layer, 100%) that the
 *      override layer has to be re-registered on `theme/change`, not just
 *      rewritten.
 *   3. One injected stylesheet, for the backdrop layer and for clearing the
 *      opaque `html` / `body` / `#root` backgrounds above it.
 *
 * The backdrop is a real element (`div[data-dsh-glass-skin-backdrop]`) rather than a
 * pseudo-element, and the app is lifted above it with an explicit positive
 * z-index instead of a negative one: v0.1 used `body::before { z-index:-1 }`,
 * which is invisible in DevTools and can be lost to a stacking context. A real
 * node with a known attribute is inspectable and predictable.
 *
 * Selectors stay on stable hooks (`html`, `body`, `#root`, `[data-windows-titlebar]`,
 * `[data-platform]`) and design tokens — no hashed CSS-module class names — so a
 * DSH upgrade degrades the look instead of breaking the UI.
 *
 * Diagnostics: `__dshGlassSkin.probe()` reports what actually reached the page.
 * Escape hatch: `__dshGlassSkin.off()` / `.on()` / `.wallpaper(url)` /
 * `.blur('72px')` / `.wash(alpha)` / `.reset()`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-glass-skin',
  factory: function () {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var NS = 'dsh-glass-skin'
    var VERSION = 21
    /** The settings namespace this plugin used before it was renamed. */
    var LEGACY_NS = 'dsh-glass'
    var STYLE_ID = NS + '/glass.css'
    var BACKDROP_ATTR = 'data-dsh-glass-skin-backdrop'
    var CHIP_ATTR = 'data-dsh-glass-skin-chip'
    var KEY = {
      on: NS + ':on',
      wallpaper: NS + ':wallpaper',
      blur: NS + ':blur',
      wash: NS + ':wash',
      glass: NS + ':glass',
    }

    /**
     * The built-in backdrop: a blurred stand-in for a desktop.
     *
     * Four wide light pools plus two small bright ones over a cool blue-grey
     * ramp. The small pools matter: they are what makes the blur legible as
     * "out of focus" rather than as a plain gradient. Values are deliberately
     * mid-tone — the glass panes and the wash both darken whatever is behind
     * them, so a backdrop that already looks dark ends up as flat grey.
     */
    var DEFAULT_BACKDROP = [
      'radial-gradient(42% 38% at 18% 22%, rgba(168,196,228,.85), rgba(168,196,228,0) 72%)',
      'radial-gradient(38% 34% at 78% 12%, rgba(126,158,206,.70), rgba(126,158,206,0) 74%)',
      'radial-gradient(46% 42% at 88% 78%, rgba(96,120,168,.65), rgba(96,120,168,0) 76%)',
      'radial-gradient(40% 36% at 30% 88%, rgba(160,140,190,.45), rgba(160,140,190,0) 78%)',
      'radial-gradient(16% 20% at 62% 36%, rgba(206,226,255,.38), rgba(206,226,255,0) 70%)',
      'radial-gradient(13% 16% at 12% 62%, rgba(190,214,246,.30), rgba(190,214,246,0) 72%)',
      'linear-gradient(158deg, #66748c 0%, #4a5670 52%, #333b4d 100%)',
    ].join(',')

    /**
     * The same idea at the other end of the range, for light mode: a bright,
     * faintly cool desktop. A dark backdrop under light labels is unreadable,
     * and a light backdrop under dark labels is what a light-mode user expects.
     */
    var LIGHT_BACKDROP = [
      'radial-gradient(44% 38% at 20% 16%, rgba(255,255,255,.92), rgba(255,255,255,0) 70%)',
      'radial-gradient(40% 36% at 82% 12%, rgba(176,202,244,.92), rgba(176,202,244,0) 72%)',
      'radial-gradient(48% 44% at 86% 84%, rgba(158,180,224,.88), rgba(158,180,224,0) 76%)',
      'radial-gradient(42% 38% at 24% 86%, rgba(206,190,238,.80), rgba(206,190,238,0) 78%)',
      'radial-gradient(16% 19% at 58% 38%, rgba(255,255,255,.55), rgba(255,255,255,0) 70%)',
      'linear-gradient(158deg, #dfe7f8 0%, #c4d1ea 52%, #a6b5da 100%)',
    ].join(',')

    /**
     * Surface tokens given an alpha channel, **per colour scheme**.
     *
     * The skin must work in whichever scheme the user chose, and must never
     * change that choice. v0.3 got both halves wrong: it forced
     * `setTheme('dark')` and used one set of dark values for both schemes, so a
     * light-mode user got dark glass under light labels — reported back as
     * "light mode is broken, and it is not light any more".
     *
     * Kept to the four tokens that paint chrome and popovers: cards, inputs and
     * message bubbles keep their solid fills, which is what keeps text readable.
     */
    var SURFACE_TOKENS = {
      // Conversation canvas. Deliberately LOW, and lower than the sidebar,
      // because the REAL stack is three deep, not two: on Windows the frame
      // paints the sidebar token across the whole window, then BOTH
      // BynINW_centerCol and Dc7zOa_root paint this token on top of it. Alphas
      // calibrated against a two-layer model therefore land ~69% opaque in
      // practice — "light mode is a flat white block". See `compositeAlpha`.
      '--dsw-alias-bg-base': { light: 'rgba(255,255,255,.15)', dark: 'rgba(16,19,25,.17)' },
      // The frame fill AND the sidebar column fill, so it stacks with itself.
      // In LIGHT mode this must be a cool grey, not near-white: chrome has to
      // read as chrome, and a near-white fill stacked twice just looks whiter
      // than the canvas it is supposed to frame. In DARK mode it has to stay
      // just above (1 - canvas)² or the chrome ends up LIGHTER than the canvas.
      '--dsw-specific-sidebar-fill': { light: 'rgba(214,222,238,.38)', dark: 'rgba(11,14,18,.40)' },
      // Menus and popovers: DSH frosts these with its own backdrop-filter and
      // paints them once, so they can stay comparatively solid.
      '--dsw-specific-menu': { light: 'rgba(255,255,255,.82)', dark: 'rgba(26,30,37,.66)' },
      '--dsw-alias-bg-overlay': { light: 'rgba(255,255,255,.88)', dark: 'rgba(24,28,34,.76)' },
    }

    /**
     * The two tokens the console's "glass strength" slider drives, and the CSS
     * variable each one is published through. The stylesheet reads the variable,
     * so a slider drag changes the painted result without a reload.
     */
    var VARIABLE = {
      '--dsw-alias-bg-base': '--dsh-glass-skin-canvas',
      '--dsw-specific-sidebar-fill': '--dsh-glass-skin-sidebar',
    }

    /** Menus and popovers are painted once and must stay readable: not adjustable. */
    var ADJUSTABLE = {
      '--dsw-alias-bg-base': true,
      '--dsw-specific-sidebar-fill': true,
    }

    // Set by apply(): the console re-stacks the token layer through these.
    var currentTheme = null
    var disposeTokens = null

    /**
     * Live references into the open console, so a value change can update it in
     * place. Rebuilding the console re-creates ~200 nodes and re-runs the whole
     * diagnosis for the details report — work that lands in the middle of the
     * very interaction that caused it (a preset click, a scheme switch), on top
     * of the presenter's own re-render. Update the changed values only.
     */
    var panelRefs = null

    function syncPanel() {
      var refs = panelRefs
      if (refs === null) return
      try {
        var strength = Math.round(glassMultiplier(schemeOf()) * 100)
        refs.glass.input.value = String(strength)
        refs.glass.readout.textContent = strength + '%'

        var blur = currentBlur()
        refs.blur.input.value = String(parseFloat(blur))
        refs.blur.readout.textContent = blur

        var wash = currentWash()
        refs.wash.input.value = String(wash)
        refs.wash.readout.textContent = wash + '%'

        refs.refresh()
      } catch (error) {
        /* a stale console is cosmetic */
      }
    }

    /** Multiply a colour's alpha, clamped to [0,1]. */
    function scaleAlpha(color, multiplier) {
      var match = /^rgba?\(([^)]+)\)$/.exec(String(color))
      if (match === null) return color
      var parts = match[1].split(',')
      var base = parts.length < 4 ? 1 : parseFloat(parts[3])
      var alpha = Math.max(0, Math.min(1, (isNaN(base) ? 1 : base) * multiplier))
      return 'rgba(' + parts[0].trim() + ',' + parts[1].trim() + ',' + parts[2].trim() + ','
        + Math.round(alpha * 1000) / 1000 + ')'
    }

    /**
     * Settings that must differ per colour scheme.
     *
     * One global value cannot serve both schemes: the same stacked fills that
     * read as chrome in dark mode read as a flat white block in light mode, and a
     * veil that darkens dark mode must LIFT light mode instead. Everything the
     * console edits is stored per scheme, with the older single value kept as a
     * fallback so an existing preference survives.
     */
    function schemeScoped(base, mode) {
      var scoped = readStore(base + ':' + mode, null)
      if (scoped !== null) return scoped
      return readStore(base, null)
    }

    function storeScoped(base, mode, value) {
      writeStore(base + ':' + mode, value)
    }

    /** The veil over the backdrop: dark in dark mode, light in light mode. */
    function washColor(mode, alpha) {
      return mode === 'dark' ? 'rgba(10,12,16,' + alpha + ')' : 'rgba(255,255,255,' + alpha + ')'
    }

    /** 1 = the shipped values, 0 = invisible surfaces, 2 = twice as solid. */
    function glassMultiplier(mode) {
      var stored = schemeScoped(KEY.glass, mode)
      if (stored === null) return 1
      var value = parseFloat(stored)
      if (isNaN(value)) return 1
      return Math.max(0, Math.min(2, value))
    }

    /** The wash strength in use for a scheme, 0..1. */
    function washStrength(mode) {
      var stored = schemeScoped(KEY.wash, mode)
      if (stored !== null) {
        var value = parseFloat(stored)
        if (!isNaN(value)) return Math.max(0, Math.min(1, value))
      }
      return mode === 'dark' ? 0.28 : 0.2
    }

    /** The scheme the presenter published, read from the page rather than assumed. */
    function schemeOf() {
      try {
        if (document.body !== null && document.body !== undefined
          && typeof document.body.getAttribute === 'function'
          && document.body.getAttribute('data-ds-dark-theme') !== null) return 'dark'
        if (document.documentElement.getAttribute('data-ds-dark-theme') !== null) return 'dark'
      } catch (error) {
        /* fall through to light */
      }
      return 'light'
    }

    /**
     * Publish the two adjustable surfaces for the current scheme and strength.
     * Called at apply, on every slider drag, and whenever the scheme flips.
     */
    function applySurfaceVars() {
      var mode = schemeOf()
      var multiplier = glassMultiplier(mode)
      Object.keys(VARIABLE).forEach(function (token) {
        setVar(VARIABLE[token], scaleAlpha(SURFACE_TOKENS[token][mode], multiplier))
      })
      // The veil is per scheme too: black for dark, white for light.
      setVar('--dsh-glass-skin-wash', washColor(mode, washStrength(mode)))
    }

    /**
     * Effective opacity of what the app paints over the backdrop, right now.
     *
     * Measured from the live ancestor chain whenever the page can be measured —
     * the stack depth differs per region (three fills over the conversation, two
     * over the sidebar) and it is not knowable in advance. The arithmetic model
     * below is only the fallback for a DOM that cannot be measured.
     */
    function liveComposite(measured) {
      var shell = measured === undefined || measured === null ? layers() : measured
      if (typeof shell.composite === 'number') return shell.composite

      var mode = schemeOf()
      var multiplier = glassMultiplier(mode)
      var sidebar = scaleAlpha(SURFACE_TOKENS['--dsw-specific-sidebar-fill'][mode], multiplier)
      var canvas = scaleAlpha(SURFACE_TOKENS['--dsw-alias-bg-base'][mode], multiplier)
      return compositeAlpha([sidebar, canvas])
    }

    /** How many fills the page is actually stacking, or null when unmeasurable. */
    function liveStackDepth(measured) {
      var shell = measured === undefined || measured === null ? layers() : measured
      var paints = 0
      for (var index = 0; index < shell.chain.length; index++) {
        var alpha = alphaOf(shell.chain[index].background)
        if (alpha !== null && alpha > 0) paints++
      }
      return paints === 0 ? null : paints
    }

    /** Signature of the layer last handed to the theme service. */
    var registeredPairs = null
    var restackFrame = null
    var restackPending = false
    var lastForcedRestack = 0

    /**
     * Re-register the token layer — as rarely as correctness allows.
     *
     * This is the expensive call in the whole plugin: it makes the theme service
     * recompute its token map and notify every subscriber, which on a long
     * conversation is a full re-render. Measured on a real install: a scheme
     * switch or a preset click cost about three seconds, and the plugin's own
     * work in that path is under 30 ms — the rest is the presenter's.
     *
     * So two guards. A pair set identical to the one already registered cannot
     * change any pixel, and is skipped. And `force` exists because a scheme
     * switch provably REPLACES the layer with the presenter's own tokens even
     * when our values are unchanged, so that path must always re-register.
     *
     * @param force - re-register even when the values are unchanged.
     */
    function restack(force) {
      if (currentTheme === null || typeof currentTheme.overrideTokens !== 'function') return

      var pairs = stackTokens()
      var signature = JSON.stringify(pairs)
      if (force !== true && signature === registeredPairs) return

      try {
        if (typeof disposeTokens === 'function') disposeTokens()
      } catch (error) {
        /* a stale layer is not fatal */
      }
      try {
        disposeTokens = currentTheme.overrideTokens(NS, pairs)
        registeredPairs = signature
      } catch (error) {
        disposeTokens = null
        registeredPairs = null
      }
    }

    /**
     * Collapse a burst into at most one restack per frame.
     *
     * A slider drag fires an input event per pixel, and a presenter can announce
     * one scheme switch with several `theme/change` events. Every restack is a
     * full presenter re-render, so they are merged; a forced call anywhere in the
     * burst keeps the merge forced.
     *
     * @param force - re-register even when the values are unchanged.
     */
    function scheduleRestack(force) {
      if (force === true) restackPending = true
      if (restackFrame !== null) return
      var run = function () {
        restackFrame = null
        var forced = restackPending
        restackPending = false
        restack(forced)
      }
      try {
        restackFrame = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame(run)
          : setTimeout(run, 16)
      } catch (error) {
        restackFrame = null
        restackPending = false
        restack(force === true)
      }
    }

    /**
     * A scheme switch, handled so it costs neither a flash nor a storm.
     *
     * The first announcement is applied synchronously: deferring it by a frame
     * paints one frame of the presenter's own opaque tokens, which reads as a
     * flash. A presenter that announces the same switch several times then falls
     * into the coalesced path — what matters is the state after the LAST
     * re-publication, not each one — so however many events a switch sends, it
     * costs one immediate re-render plus at most one trailing one.
     */
    function restackForSchemeSwitch() {
      var now = Date.now()
      if (now - lastForcedRestack > 250) {
        lastForcedRestack = now
        restack(true)
        return
      }
      scheduleRestack(true)
    }

    /** The four surface tokens for both schemes, at each scheme's own strength. */
    function stackTokens() {
      var pairs = {}
      Object.keys(SURFACE_TOKENS).forEach(function (token) {
        var adjustable = ADJUSTABLE[token] === true
        pairs[token] = {
          light: scaleAlpha(SURFACE_TOKENS[token].light, adjustable ? glassMultiplier('light') : 1),
          dark: scaleAlpha(SURFACE_TOKENS[token].dark, adjustable ? glassMultiplier('dark') : 1),
        }
      })
      return pairs
    }

    /** One scheme's four tokens as stylesheet declarations; adjustable ones via var. */
    function forcedTokenCss(mode) {
      return Object.keys(SURFACE_TOKENS)
        .map(function (token) {
          var fallback = SURFACE_TOKENS[token][mode]
          var variable = ADJUSTABLE[token] === true ? VARIABLE[token] : undefined
          if (variable !== undefined) {
            return '  ' + token + ': var(' + variable + ', ' + fallback + ') !important;'
          }
          return '  ' + token + ': ' + fallback + ' !important;'
        })
        .join('\n')
    }

    var CSS = `
/* --- dsh-glass-skin ------------------------------------------------------- */
/* Clear every opaque layer between the page root and the backdrop. */
html, body { background-color: transparent !important; background-image: none !important; }
#root { background: transparent !important; }

/* The glass surfaces, mirrored into CSS from the scheme the presenter published.
   This block follows the ACTIVE colour scheme, so it is the layer that keeps the
   two schemes apart even for a paint that happens before the theme service has
   re-published anything.

   It is NOT the load-bearing path. The presenter publishes its tokens as
   important inline custom properties, and an inline important declaration
   outranks a stylesheet important one — so the registered override layer
   (ctx.theme.overrideTokens) is the only thing that actually makes the glass
   translucent. Everything here is per-scheme fallback for the moment between a
   scheme switch and the re-registration in restack().

   Gated twice: on the on/off flag (so switching the skin off really restores
   the product's palette), and on the ACTIVE COLOUR SCHEME, which the presenter
   publishes as the
   body[data-ds-dark-theme] attribute. v0.3 shipped one dark value for both
   schemes and broke light mode; each scheme now carries its own. */
html:not([data-dsh-glass-skin="off"]):not([data-ds-dark-theme]),
html:not([data-dsh-glass-skin="off"]) body:not([data-ds-dark-theme]) {
${forcedTokenCss('light')}
}
html:not([data-dsh-glass-skin="off"])[data-ds-dark-theme],
html:not([data-dsh-glass-skin="off"]) body[data-ds-dark-theme],
html:not([data-dsh-glass-skin="off"]):has(body[data-ds-dark-theme]) {
${forcedTokenCss('dark')}
}

/* The backdrop and the wash follow the same scheme, so neither scheme gets a
   backdrop that fights its label colours. */
body {
  --dsh-glass-skin-backdrop-default: ${LIGHT_BACKDROP};
  --dsh-glass-skin-wash-default: rgba(255,255,255,.20);
  --dsh-glass-skin-saturate: 128%;
}
body[data-ds-dark-theme] {
  --dsh-glass-skin-backdrop-default: ${DEFAULT_BACKDROP};
  --dsh-glass-skin-wash-default: rgba(10,12,16,.28);
  --dsh-glass-skin-saturate: 145%;
}

/* The blurred backdrop: a real element, so it can be inspected and cannot be
   lost to a stacking context. The picture rides ON TOP of the built-in
   gradient, never replaces it: a CSS background whose image fails to load
   paints nothing, and glass over nothing is a black window. */
div[${BACKDROP_ATTR}] {
  position: fixed;
  inset: -14%;
  z-index: 0;
  pointer-events: none;
  background-image: var(--dsh-glass-skin-photo, none), var(--dsh-glass-skin-backdrop-default, ${DEFAULT_BACKDROP});
  background-size: cover, cover;
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
  filter: blur(var(--dsh-glass-skin-blur, 64px)) saturate(var(--dsh-glass-skin-saturate, 145%));
  transform: scale(1.06);
}

/* The wash sits on the backdrop, still under the app: it pulls contrast back
   for text without hiding the blur. */
div[${BACKDROP_ATTR}]::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--dsh-glass-skin-wash, var(--dsh-glass-skin-wash-default, rgba(10,12,16,.20)));
}

/* Lift the app above the backdrop explicitly — no negative z-index. */
#root { position: relative; z-index: 1; }

/* Switched off: step out of the way entirely. */
html[data-dsh-glass-skin="off"] div[${BACKDROP_ATTR}] { display: none; }
`

    /** localStorage, defensively — a locked-down context must not throw. */
    function readStore(key, fallback) {
      try {
        var value = localStorage.getItem(key)
        return value === null ? fallback : value
      } catch (error) {
        return fallback
      }
    }

    function writeStore(key, value) {
      try {
        if (value === null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch (error) {
        /* a preference that cannot persist is not a failure */
      }
    }

    /**
     * Inject the stylesheet, refreshing it when the code changed.
     *
     * The id guard alone is NOT enough: HMR re-materializes this module with new
     * code while its first `<style>` tag is still in the document, and a plugin
     * update does the same. Trusting the id would pin the page to the first
     * stylesheet it ever saw — which is exactly how a mid-edit stylesheet whose
     * tokens interpolated to the string "undefined" survived every later fix,
     * leaving new code driving an old, broken sheet.
     */
    function injectCss() {
      if (typeof document === 'undefined') return false
      var selector = 'style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']'
      var existing = document.querySelector(selector)
      if (existing !== null && existing !== undefined) {
        try {
          if (existing.textContent !== CSS) existing.textContent = CSS
        } catch (error) {
          /* a tag we cannot rewrite still applies its old rules */
        }
        return true
      }
      var tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return true
    }

    /**
     * Put the backdrop node in the DOM. Created once, kept across re-applies,
     * and inserted as the first child of <body> so it paints below the app
     * without needing a negative z-index.
     */
    function ensureBackdrop() {
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return null
      var existing = document.querySelector('div[' + BACKDROP_ATTR + ']')
      if (existing !== null) return existing
      var node = document.createElement('div')
      node.setAttribute(BACKDROP_ATTR, '')
      try {
        document.body.insertBefore(node, document.body.firstChild)
      } catch (error) {
        try {
          document.body.appendChild(node)
        } catch (inner) {
          return null
        }
      }
      return node
    }

    /**
     * Reflect the console's open state on the button: quiet while idle, lit
     * while the console is up. Both ends can close it, so both call this.
     */
    function syncChipState() {
      try {
        var chip = document.querySelector('div[' + CHIP_ATTR + ']')
        if (chip === null || chip === undefined) return
        var open = document.getElementById(NS + '-panel') !== null
        chip.style.opacity = open ? '1' : '.62'
        chip.style.borderColor = open
          ? 'var(--dsw-alias-brand-primary,#4176e6)'
          : 'var(--dsw-alias-border-l2,rgba(255,255,255,.16))'
      } catch (error) {
        /* cosmetic only */
      }
    }

    /**
     * The console's button: a translucent circle, no label.
     *
     * Desktop intercepts complete key combinations through its native keyboard
     * bridge BEFORE any DOM handler runs, so a hotkey cannot be relied on:
     * Ctrl+Alt+G just triggered the app's own rename command. A click target has
     * no such competition, which makes this the only dependable way to reach the
     * console. The glyph is a half-filled circle — appearance/contrast — with a
     * title and aria-label carrying the words a glyph cannot.
     */
    function ensureChip() {
      if (typeof document === 'undefined' || document.body === null || document.body === undefined) return null
      var existing = document.querySelector('div[' + CHIP_ATTR + ']')
      if (existing !== null && existing !== undefined) return existing

      // A glyph, not a label: the control has no text. An inline SVG keeps it
      // dependency-free; a DOM without SVG support (the unit-test stub) still
      // gets a mark so the button is never blank.
      var glyph = null
      try {
        if (typeof document.createElementNS === 'function') {
          var SVG = 'http://www.w3.org/2000/svg'
          glyph = document.createElementNS(SVG, 'svg')
          glyph.setAttribute('viewBox', '0 0 16 16')
          glyph.setAttribute('width', '15')
          glyph.setAttribute('height', '15')
          glyph.setAttribute('aria-hidden', 'true')
          glyph.setAttribute('focusable', 'false')
          // The half-filled circle: appearance / contrast, the same idea the
          // platform's own appearance control uses.
          var ring = document.createElementNS(SVG, 'circle')
          ring.setAttribute('cx', '8')
          ring.setAttribute('cy', '8')
          ring.setAttribute('r', '6.25')
          ring.setAttribute('fill', 'none')
          ring.setAttribute('stroke', 'currentColor')
          ring.setAttribute('stroke-width', '1.5')
          var half = document.createElementNS(SVG, 'path')
          half.setAttribute('d', 'M8 1.75a6.25 6.25 0 0 0 0 12.5z')
          half.setAttribute('fill', 'currentColor')
          glyph.appendChild(ring)
          glyph.appendChild(half)
        }
      } catch (error) {
        glyph = null
      }
      if (glyph === null) {
        glyph = document.createElement('span')
        glyph.textContent = '\u25d0'
      }

      var node = document.createElement('div')
      node.setAttribute(CHIP_ATTR, '')
      node.setAttribute('role', 'button')
      node.setAttribute('aria-label', 'dsh-glass-skin 控制台')
      node.title = 'dsh-glass-skin 控制台：透明度、模糊、壁纸'
      // Apple-ish material: a translucent, backdrop-blurred circle with a
      // hairline edge and a soft two-part shadow, on a spring-ish transition.
      node.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482000;'
        + 'width:30px;height:30px;box-sizing:border-box;padding:0;'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'border-radius:50%;cursor:pointer;user-select:none;'
        + 'color:var(--dsw-alias-label-secondary,#aeb6c0);'
        + 'background:color-mix(in srgb, var(--dsw-alias-bg-layer-2,#1b1e23) 74%, transparent);'
        + 'border:.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));'
        + 'backdrop-filter:blur(20px) saturate(180%);'
        + '-webkit-backdrop-filter:blur(20px) saturate(180%);'
        + 'box-shadow:0 1px 2px rgba(0,0,0,.16),0 6px 16px rgba(0,0,0,.18);'
        + 'opacity:.62;'
        + 'transition:opacity .18s ease,transform .18s cubic-bezier(.2,.8,.2,1),border-color .18s ease'
      node.appendChild(glyph)

      node.addEventListener('mouseenter', function () {
        try {
          node.style.opacity = '1'
          node.style.transform = 'scale(1.06)'
        } catch (error) {
          /* cosmetic */
        }
      })
      node.addEventListener('mouseleave', function () {
        try {
          node.style.transform = 'scale(1)'
          syncChipState()
        } catch (error) {
          /* cosmetic */
        }
      })
      node.addEventListener('mousedown', function () {
        try {
          node.style.transform = 'scale(.94)'
        } catch (error) {
          /* cosmetic */
        }
      })
      node.addEventListener('mouseup', function () {
        try {
          node.style.transform = 'scale(1.06)'
        } catch (error) {
          /* cosmetic */
        }
      })
      node.addEventListener('click', function (event) {
        try {
          event.stopPropagation()
        } catch (error) {
          /* ignore */
        }
        panel(document.getElementById(NS + '-panel') === null)
        syncChipState()
      })

      try {
        document.body.appendChild(node)
      } catch (error) {
        return null
      }
      return node
    }

    function setVar(name, value) {
      try {
        if (value === null || value === undefined) document.documentElement.style.removeProperty(name)
        else document.documentElement.style.setProperty(name, value)
      } catch (error) {
        /* ignore */
      }
    }

    /**
     * Resolve the theme service. The module declares `theme` as a hard
     * dependency, so `ctx.theme` is normally present; `ctx.get` is the
     * belt-and-braces path for a host that hands over a bare context.
     */
    function themeOf(ctx) {
      if (ctx === null || ctx === undefined) return undefined
      if (ctx.theme !== undefined && ctx.theme !== null) return ctx.theme
      if (typeof ctx.get === 'function') {
        var found = ctx.get('theme')
        return found === undefined ? undefined : found
      }
      return undefined
    }

    /** Read one computed property, never throwing. */
    function computed(node, property) {
      try {
        if (node === null || node === undefined || typeof getComputedStyle !== 'function') return null
        var value = getComputedStyle(node).getPropertyValue(property)
        return value === '' ? null : value.trim()
      } catch (error) {
        return 'ERROR: ' + error
      }
    }

    function rectOf(node) {
      try {
        var rect = node.getBoundingClientRect()
        return {
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          top: Math.round(rect.top),
          left: Math.round(rect.left),
        }
      } catch (error) {
        return null
      }
    }

    /**
     * Report what actually reached the page.
     *
     * This exists because a skin can fail in ways that look identical from the
     * outside: stylesheet missing, backdrop present but never painted, or
     * tokens left opaque. The report separates those cases instead of guessing.
     *
     * @returns a plain JSON-safe object, safe to paste into a bug report.
     */
    function probe() {
      var backdrop = document.querySelector('div[' + BACKDROP_ATTR + ']')
      var root = document.getElementById('root')
      var firstChild = root !== null && root.firstElementChild !== null ? root.firstElementChild : null
      var shadowHosts = 0
      try {
        var all = document.querySelectorAll('*')
        for (var i = 0; i < all.length; i++) if (all[i].shadowRoot !== null && all[i].shadowRoot !== undefined) shadowHosts++
      } catch (error) {
        shadowHosts = -1
      }
      return {
        plugin: NS,
        version: VERSION,
        flag: document.documentElement.getAttribute('data-dsh-glass-skin'),
        scheme: (function () {
          try {
            var onBody = typeof document.body.getAttribute === 'function'
              ? document.body.getAttribute('data-ds-dark-theme') !== null
              : false
            var onHtml = document.documentElement.getAttribute('data-ds-dark-theme') !== null
            return onBody || onHtml ? 'dark' : 'light'
          } catch (error) {
            return 'unknown'
          }
        })(),
        stylesheets: (function () {
          var ids = []
          try {
            var tags = document.querySelectorAll('style[data-plugin-css]')
            for (var i = 0; i < tags.length; i++) ids.push(tags[i].getAttribute('data-plugin-css'))
          } catch (error) {
            ids.push('ERROR: ' + error)
          }
          return ids
        })(),
        sky: (function () {
          if (backdrop === null) return { exists: false }
          var style = null
          try {
            style = getComputedStyle(backdrop)
          } catch (error) {
            /* leave null */
          }
          return {
            exists: true,
            rect: rectOf(backdrop),
            display: style === null ? null : style.display,
            opacity: style === null ? null : style.opacity,
            zIndex: style === null ? null : style.zIndex,
            filter: style === null ? null : style.filter,
            backgroundImage: style === null ? null : String(style.backgroundImage).slice(0, 90),
          }
        })(),
        tokens: {
          bgBaseOnBody: computed(document.body, '--dsw-alias-bg-base'),
          bgBaseOnHtml: computed(document.documentElement, '--dsw-alias-bg-base'),
          sidebarOnBody: computed(document.body, '--dsw-specific-sidebar-fill'),
        },
        paint: {
          html: computed(document.documentElement, 'background-color'),
          body: computed(document.body, 'background-color'),
          root: computed(root, 'background-color'),
          rootPosition: computed(root, 'position'),
          rootZIndex: computed(root, 'z-index'),
          appFrame: firstChild === null
            ? null
            : {
                tag: firstChild.tagName,
                className: String(firstChild.className).slice(0, 70),
                background: computed(firstChild, 'background-color'),
              },
        },
        shadowHosts: shadowHosts,
        userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      }
    }

    /** Alpha channel of a computed colour, or null when it is not a colour. */
    function alphaOf(value) {
      if (typeof value !== 'string') return null
      if (value === 'transparent') return 0
      var match = /^rgba?\(([^)]+)\)$/.exec(value)
      if (match === null) return null
      var parts = match[1].split(',')
      if (parts.length < 4) return 1
      var alpha = parseFloat(parts[3])
      return isNaN(alpha) ? 1 : alpha
    }

    /**
     * Effective opacity of stacked translucent fills, in paint order.
     *
     * Outermost first: the frame paints, then its descendants on top of it, so
     * each later fill covers a shrinking share of whatever is behind. This is
     * the number that decides whether the backdrop is visible at all — two
     * innocent-looking 0.6 fills composite to 0.84, which reads as "no glass".
     */
    function compositeAlpha(backgrounds) {
      var total = 0
      for (var index = 0; index < backgrounds.length; index++) {
        var alpha = alphaOf(backgrounds[index])
        if (alpha === null) continue
        total = total + alpha * (1 - total)
      }
      return Math.round(total * 1000) / 1000
    }

    /** One element, reduced to what decides whether it hides the backdrop. */
    function describeNode(node) {
      if (node === null || node === undefined) return null
      return {
        tag: node.tagName,
        className: typeof node.className === 'string' ? node.className.slice(0, 90) : '',
        id: node.id === undefined ? null : node.id,
        background: computed(node, 'background-color'),
        position: computed(node, 'position'),
        zIndex: computed(node, 'z-index'),
      }
    }

    /**
     * Where the opaque layer actually is.
     *
     * The token report says what the skin declared; this says what the page
     * paints. When the glass "does nothing", one of these two is lying, and this
     * is the one that separates them: it names the topmost element under #root
     * (the app's own canvas) and walks up from whatever is really painted at the
     * centre of the viewport, shadow roots included.
     */
    function layers() {
      var out = { fromRoot: [], atCentre: null, inShadow: false, chain: [], underRoot: null, composite: null }

      try {
        var root = document.getElementById('root')
        var node = root
        for (var depth = 0; node !== null && node !== undefined && depth < 8; depth++) {
          out.fromRoot.push(describeNode(node))
          node = node.firstElementChild
        }
      } catch (error) {
        out.fromRootError = String(error)
      }

      try {
        var viewport = typeof window === 'undefined' ? null : window
        var width = viewport === null ? 0 : viewport.innerWidth
        var height = viewport === null ? 0 : viewport.innerHeight
        var x = Math.round(width / 2)
        var y = Math.round(height / 2)

        var target = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
        out.atCentre = describeNode(target)

        if (target !== null && target !== undefined && target.shadowRoot !== null && target.shadowRoot !== undefined) {
          out.inShadow = true
          if (typeof target.shadowRoot.elementFromPoint === 'function') {
            var inner = target.shadowRoot.elementFromPoint(x, y)
            out.atCentreInShadow = describeNode(inner)
            if (inner !== null && inner !== undefined) target = inner
          }
        }

        // Walk up to #root, keeping the last element before the root: that is
        // the app's own canvas, the surface the glass has to be able to see past.
        // Walk up to #root. The cap is generous on purpose: on Windows the
        // conversation content sits a dozen levels below the frame that paints
        // the sidebar fill across the whole window, and the composite of every
        // fill on that path is what decides whether the glass is visible.
        var up = target
        var rootNode = document.getElementById('root')
        for (var step = 0; up !== null && up !== undefined && step < 40; step++) {
          var described = describeNode(up)
          if (described !== null) out.chain.push(described)
          if (up.parentElement === rootNode) out.underRoot = described
          up = up.parentElement
        }

        // Paint order is outermost first; the chain is innermost first.
        var paints = []
        for (var index = out.chain.length - 1; index >= 0; index--) {
          paints.push(out.chain[index].background)
        }
        out.composite = out.chain.length === 0 ? null : compositeAlpha(paints)
      } catch (error) {
        out.centreError = String(error)
      }

      return out
    }

    /**
     * Judge whether the glass actually took, from the probed facts.
     *
     * @returns `{ ok, reasons, report }` — `reasons` is empty exactly when the
     *   skin is doing what it promises.
     */
    function diagnose(measured) {
      var report = probe()
      var reasons = []

      // "Off" is a legitimate state, not a failure: the skin claims nothing
      // then, so the self-check stays silent and the panel stays away.
      if (report.flag === 'off') return { ok: true, off: true, reasons: reasons, report: report }

      var canvas = report.tokens.bgBaseOnBody
      if (canvas === null || canvas === undefined || String(canvas).indexOf('rgba(') !== 0) {
        reasons.push('会话画布令牌不是半透明色: ' + String(canvas))
      }

      if (report.sky.exists !== true) {
        reasons.push('背景层节点不存在')
      } else {
        if (report.sky.display === 'none') reasons.push('背景层被 display:none 隐藏（皮肤处于关闭状态？）')
        if (report.sky.rect !== null && (report.sky.rect.w === 0 || report.sky.rect.h === 0)) {
          reasons.push('背景层尺寸为 0')
        }
        var image = report.sky.backgroundImage
        if (image === null || image === undefined || image === 'none') reasons.push('背景层没有背景图')
      }

      var rootPaint = report.paint.root
      if (rootPaint !== null && rootPaint !== undefined && rootPaint !== 'rgba(0, 0, 0, 0)') {
        reasons.push('#root 仍在绘制不透明底色: ' + String(rootPaint))
      }

      // The decisive one: what the app actually paints over the backdrop.
      // Stacked translucent fills multiply, so a pair of innocent 0.6 fills
      // hides the backdrop completely. v0.1–v0.7 looked exactly like the
      // product's own opaque UI for this reason, and nothing else in this report
      // showed it — the tokens were "translucent" the whole time.
      var shell = measured === undefined || measured === null ? layers() : measured
      if (typeof shell.composite === 'number' && shell.composite > 0.85) {
        reasons.push(
          '画布上叠加的玻璃有效不透明度约 ' + Math.round(shell.composite * 100)
          + '% —— 背景基本被盖住，需要调低令牌 alpha',
        )
      }

      return { ok: reasons.length === 0, off: false, reasons: reasons, report: report }
    }

    /**
     * Render the diagnosis into the page itself.
     *
     * DevTools is not always reachable — a packaged Electron app frequently
     * disables F12 and the context menu — so the skin reports failures where the
     * user can actually see them. Styled inline so it renders even when the
     * injected stylesheet is the thing that broke.
     *
     * @param show - `false` removes the panel; anything else renders it.
     */
    /**
     * Console container styling. Host theme tokens only — no hardcoded palette —
     * so it sits in the product's own surfaces and reads correctly in either
     * scheme, which is what the plugin UI rules ask for.
     */
    function consoleCss() {
      return [
        'position:fixed',
        'right:14px',
        'bottom:58px',
        'z-index:2147483000',
        'width:276px',
        'box-sizing:border-box',
        'padding:12px 14px 13px',
        'border-radius:var(--dsw-radius-lg,14px)',
        'background:var(--dsw-alias-bg-layer-2,rgba(26,30,37,.94))',
        'border:.5px solid var(--dsw-alias-border-l1,rgba(255,255,255,.12))',
        'box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.35))',
        'color:var(--dsw-alias-label-primary,#eef1f5)',
        'font:12px/1.6 var(--dsw-font-family,system-ui,sans-serif)',
        'user-select:none',
      ].join(';')
    }

    /** A labelled control row; returns the line and its live readout. */
    function controlRow(labelText, control) {
      var line = document.createElement('div')
      line.style.cssText = 'display:flex;align-items:center;gap:8px;margin:7px 0'

      var label = document.createElement('span')
      label.textContent = labelText
      label.style.cssText = 'flex:none;width:44px;color:var(--dsw-alias-label-secondary,#a8b0ba)'
      line.appendChild(label)
      line.appendChild(control)

      var readout = document.createElement('span')
      readout.style.cssText = 'flex:none;width:48px;text-align:right;font-variant-numeric:tabular-nums;'
        + 'color:var(--dsw-alias-label-tertiary,#8d949e);font-size:11px'
      line.appendChild(readout)

      return { line: line, readout: readout }
    }

    function rangeInput(min, max, step, value, onInput) {
      var input = document.createElement('input')
      input.type = 'range'
      input.min = String(min)
      input.max = String(max)
      input.step = String(step)
      input.value = String(value)
      input.style.cssText = 'flex:1;min-width:0;accent-color:var(--dsw-alias-brand-primary,#4176e6)'
      input.addEventListener('input', function () {
        onInput(parseFloat(input.value))
      })
      return input
    }

    function consoleButton(label, onClick) {
      var node = document.createElement('button')
      node.textContent = label
      node.style.cssText = 'flex:1;min-width:0;cursor:pointer;padding:4px 6px;'
        + 'border-radius:var(--dsw-radius-sm,6px);'
        + 'border:.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));'
        + 'background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));'
        + 'color:var(--dsw-alias-label-primary,#eef1f5);font:inherit'
      node.addEventListener('click', onClick)
      return node
    }

    /** The three wallpaper glyphs. Shapes only: stroke and colour come from CSS. */
    var ICON_IMAGE = [
      { tag: 'rect', attrs: { x: '1.9', y: '2.9', width: '12.2', height: '10.2', rx: '2.1' } },
      { tag: 'circle', attrs: { cx: '5.7', cy: '6.4', r: '1.1', fill: 'currentColor', stroke: 'none' } },
      { tag: 'path', attrs: { d: 'M2.5 11.6l3.1-2.8 2.8 2.4 2.2-1.8 2.9 2.3' } },
    ]
    var ICON_CHECK = [{ tag: 'path', attrs: { d: 'M3.4 8.6l3.1 3.1 6.1-7.2' } }]
    var ICON_CLEAR = [
      { tag: 'circle', attrs: { cx: '8', cy: '8', r: '5.9' } },
      { tag: 'path', attrs: { d: 'M4 4l8 8' } },
    ]

    /** One inline SVG from shape descriptors; no framework, no icon font. */
    function svgIcon(parts, size) {
      try {
        if (typeof document.createElementNS !== 'function') throw new Error('no SVG support')
        var SVG = 'http://www.w3.org/2000/svg'
        var svg = document.createElementNS(SVG, 'svg')
        svg.setAttribute('viewBox', '0 0 16 16')
        svg.setAttribute('width', String(size))
        svg.setAttribute('height', String(size))
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '1.55')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        svg.setAttribute('aria-hidden', 'true')
        svg.setAttribute('focusable', 'false')
        parts.forEach(function (part) {
          var shape = document.createElementNS(SVG, part.tag)
          Object.keys(part.attrs).forEach(function (name) {
            shape.setAttribute(name, part.attrs[name])
          })
          svg.appendChild(shape)
        })
        return svg
      } catch (error) {
        // A DOM without SVG still gets a visible mark, never an empty button.
        var fallback = document.createElement('span')
        fallback.textContent = '\u2022'
        return fallback
      }
    }

    /**
     * A square icon button. The words move into `title` and `aria-label`, so the
     * control stays as legible as a labelled one without spending row width.
     */
    function iconButton(parts, label, onClick) {
      var node = document.createElement('button')
      node.setAttribute('type', 'button')
      node.setAttribute('aria-label', label)
      node.setAttribute('title', label)
      node.style.cssText = 'flex:none;width:26px;height:26px;padding:0;cursor:pointer;'
        + 'display:flex;align-items:center;justify-content:center;'
        + 'border-radius:var(--dsw-radius-sm,6px);'
        + 'border:.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));'
        + 'background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));'
        + 'color:var(--dsw-alias-label-primary,#eef1f5)'
      node.appendChild(svgIcon(parts, 14))
      node.addEventListener('click', onClick)
      return node
    }

    /**
     * Apply a wallpaper, but only once it is known to load.
     *
     * A CSS background that fails to load paints nothing. With the glass on top
     * of nothing the whole window goes black, which reads as "the wallpaper
     * broke the skin" — so the built-in gradient stays underneath either way,
     * and a picture that never arrives is reported instead of silently applied.
     *
     * @param url - the picture address, or empty to go back to the built-in one.
     * @param onResult - called with 'ok' | 'failed' | 'unverified' | 'cleared'.
     */
    function applyWallpaper(url, onResult) {
      function report(result) {
        if (typeof onResult !== 'function') return
        try {
          onResult(result)
        } catch (error) {
          /* a reporting callback must never break the skin */
        }
      }

      var trimmed = String(url === undefined || url === null ? '' : url).trim()
      if (trimmed === '') {
        writeStore(KEY.wallpaper, null)
        setVar('--dsh-glass-skin-photo', null)
        report('cleared')
        return
      }

      // Quotes and newlines would break out of the url("…") token.
      function literalOf(value) {
        return 'url("' + value.replace(/"/g, '\\"').replace(/[\n\r]/g, '') + '")'
      }

      function commit(value) {
        writeStore(KEY.wallpaper, value)
        setVar('--dsh-glass-skin-photo', literalOf(value))
      }

      if (typeof Image !== 'function') {
        // No way to probe (a minimal DOM): apply it and say so.
        commit(trimmed)
        report('unverified')
        return
      }

      /**
       * Picture addresses are routinely copied from a search-results page rather
       * than from the picture itself. Those links are HTML, and the real address
       * rides inside one of their query parameters — Bing and Google both ship
       * it as `mediaurl`. Pull it out so a pasted link still works.
       */
      function embeddedPicture(value) {
        try {
          if (typeof URL !== 'function') return null
          var parsed = new URL(value)
          var keys = ['mediaurl', 'imgurl', 'imageurl', 'image', 'url', 'src', 'u']
          for (var index = 0; index < keys.length; index++) {
            var candidate = parsed.searchParams.get(keys[index])
            if (candidate !== null && /^(?:https?:\/\/|data:image\/)/i.test(candidate)) return candidate
          }
        } catch (error) {
          /* not a URL at all */
        }
        return null
      }

      function attempt(value, allowExtraction) {
        var probe = new Image()
        probe.onload = function () {
          commit(value)
          report(value === trimmed ? 'ok' : 'extracted')
        }
        probe.onerror = function () {
          if (allowExtraction) {
            var nested = embeddedPicture(value)
            if (nested !== null && nested !== value) {
              attempt(nested, false)
              return
            }
          }
          // Leave whatever is stored alone: a transient failure must not erase
          // the setting. Just do not paint a picture that will not arrive.
          setVar('--dsh-glass-skin-photo', null)
          report('failed')
        }
        probe.src = value
      }

      try {
        attempt(trimmed, true)
      } catch (error) {
        commit(trimmed)
        report('unverified')
      }
    }

    /**
     * Carry saved preferences over from the pre-rename namespace, once.
     *
     * Every setting lives under `<namespace>:<name>`, so renaming the plugin
     * silently resets a user's whole tuning — including the separately stored
     * light and dark strengths. Copying is cheaper than asking them to redo it.
     *
     * The on/off flag doubles as the marker: once the new namespace holds one,
     * this has either already run or the old plugin was never installed.
     */
    function migrateLegacySettings() {
      try {
        if (readStore(KEY.on, null) !== null) return

        var moved = 0
        ;['on', 'wallpaper', 'blur', 'wash', 'glass'].forEach(function (name) {
          var value = readStore(LEGACY_NS + ':' + name, null)
          if (value === null) return
          writeStore(KEY[name], value)
          moved++
        })
        ;['light', 'dark'].forEach(function (scheme) {
          ;['glass', 'wash'].forEach(function (name) {
            var value = readStore(LEGACY_NS + ':' + name + ':' + scheme, null)
            if (value === null) return
            writeStore(KEY[name] + ':' + scheme, value)
            moved++
          })
        })

        if (moved > 0) {
          console.log('[dsh-glass-skin] carried over ' + moved
            + ' saved preference(s) from the ' + LEGACY_NS + ' namespace')
        }
      } catch (error) {
        /* a failed migration must never stop the skin from loading */
      }
    }

    /** The wash strength in use for the current scheme, as a percent. */
    function currentWash() {
      return Math.round(washStrength(schemeOf()) * 100)
    }

    /** The blur radius in use. */
    function currentBlur() {
      var stored = readStore(KEY.blur, null)
      if (stored !== null) {
        var value = parseFloat(stored)
        if (!isNaN(value)) return Math.round(value)
      }
      var resolved = computed(document.documentElement, '--dsh-glass-skin-blur')
      var parsed = resolved === null ? NaN : parseFloat(resolved)
      return isNaN(parsed) ? 64 : Math.round(parsed)
    }

    /**
     * The console: the skin's own controls, reachable by mouse alone.
     *
     * A hotkey cannot serve here — Desktop intercepts accepted key combinations
     * through its native keyboard bridge before any DOM handler — and the
     * product's Settings pages belong to the product. This is the plugin's own
     * surface, styled from host tokens so it still looks native.
     *
     * @param show - `false` removes the console; anything else renders it.
     */
    function panel(show) {
      try {
        var panelId = NS + '-panel'
        var existing = document.getElementById(panelId)
        if (existing !== null && existing !== undefined) existing.remove()
        if (show === false) return null
        if (document.body === null || document.body === undefined) return null

        var root = document.createElement('div')
        root.id = panelId
        root.setAttribute('data-dsh-glass-skin-panel', '')
        root.style.cssText = consoleCss()

        function close() {
          try {
            if (root.parentNode !== null && root.parentNode !== undefined) root.parentNode.removeChild(root)
          } catch (error) {
            /* ignore */
          }
          panelRefs = null
          syncChipState()
        }

        // ---- header -------------------------------------------------------
        var header = document.createElement('div')
        header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:1px'

        var heading = document.createElement('span')
        // The build number in the header: it is how you tell at a glance whether
        // the page is running the code you just shipped.
        heading.textContent = 'dsh-glass-skin v' + VERSION
        heading.style.cssText = 'font-weight:600'
        header.appendChild(heading)

        var state = document.createElement('span')
        state.style.cssText = 'margin-left:auto;font-size:11px'
        header.appendChild(state)

        var closeButton = document.createElement('span')
        closeButton.textContent = '\u00d7'
        closeButton.setAttribute('role', 'button')
        closeButton.setAttribute('aria-label', 'close')
        closeButton.style.cssText = 'cursor:pointer;padding:0 3px;font-size:16px;line-height:1;'
          + 'color:var(--dsw-alias-label-tertiary,#8d949e)'
        closeButton.addEventListener('click', close)
        header.appendChild(closeButton)
        root.appendChild(header)

        var summary = document.createElement('div')
        summary.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-tertiary,#8d949e);margin:1px 0 6px'
        root.appendChild(summary)

        function refreshStatus() {
          // One pass: measure everything first, then write. Alternating a read
          // (getComputedStyle) with a write (textContent) forces a style
          // recalculation each time, and this runs on every slider step, with
          // three passes of the ancestor chain unless they share a measurement.
          var measured = layers()
          var verdict = diagnose(measured)
          var percent = Math.round(liveComposite(measured) * 100)
          var depth = liveStackDepth(measured)
          var mode = schemeOf()

          state.textContent = verdict.ok ? (verdict.off === true ? '已关闭' : '生效中') : '未生效'
          state.style.color = verdict.ok
            ? 'var(--dsw-alias-state-success-primary,#22c55e)'
            : 'var(--dsw-alias-state-warn-primary,#f59e0b)'
          summary.textContent = (mode === 'dark' ? '深色' : '浅色') + '模式'
            + (depth === null ? '' : ' · ' + depth + ' 层')
            + ' · 叠加后不透明度 ' + percent + '%'
            + (percent > 85 ? ' · 太实了，调低浓度' : (percent < 25 ? ' · 几乎全透' : ''))
        }

        // ---- 玻璃浓度（按当前配色独立保存）--------------------------------
        var glassInput = rangeInput(0, 150, 5, Math.round(glassMultiplier(schemeOf()) * 100), function (value) {
          storeScoped(KEY.glass, schemeOf(), String(value / 100))
          applySurfaceVars()
          // A drag fires this per pixel; the presenter only needs the value that
          // survives to the next frame.
          scheduleRestack()
          glass.readout.textContent = value + '%'
          refreshStatus()
        })
        var glass = controlRow('浓度', glassInput)
        glass.readout.textContent = Math.round(glassMultiplier(schemeOf()) * 100) + '%'
        root.appendChild(glass.line)

        // ---- 背景模糊 -----------------------------------------------------
        var blurInput = rangeInput(0, 120, 2, currentBlur(), function (value) {
          writeStore(KEY.blur, value + 'px')
          setVar('--dsh-glass-skin-blur', value + 'px')
          blur.readout.textContent = value + 'px'
        })
        var blur = controlRow('模糊', blurInput)
        blur.readout.textContent = currentBlur() + 'px'
        root.appendChild(blur.line)

        // ---- 遮罩（按当前配色独立保存）------------------------------------
        var washInput = rangeInput(0, 100, 2, currentWash(), function (value) {
          storeScoped(KEY.wash, schemeOf(), String(value / 100))
          // The veil follows the scheme. Hardcoding black here is what made light
          // mode look dirty: a dark veil over a light UI darkens everything.
          setVar('--dsh-glass-skin-wash', washColor(schemeOf(), value / 100))
          wash.readout.textContent = value + '%'
          refreshStatus()
        })
        var wash = controlRow('遮罩', washInput)
        wash.readout.textContent = currentWash() + '%'
        root.appendChild(wash.line)

        // ---- 壁纸 ---------------------------------------------------------
        var wallpaperRow = document.createElement('div')
        wallpaperRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:7px 0'

        var wallpaperLabel = document.createElement('span')
        wallpaperLabel.textContent = '壁纸'
        wallpaperLabel.style.cssText = 'flex:none;width:44px;color:var(--dsw-alias-label-secondary,#a8b0ba)'
        wallpaperRow.appendChild(wallpaperLabel)

        var wallpaperInput = document.createElement('input')
        wallpaperInput.type = 'text'
        wallpaperInput.placeholder = '图片 URL'
        wallpaperInput.style.cssText = 'flex:1;min-width:0;padding:3px 7px;box-sizing:border-box;'
          + 'border-radius:var(--dsw-radius-sm,6px);font:inherit;'
          + 'border:.5px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));'
          + 'background:var(--dsw-alias-bg-base,rgba(0,0,0,.25));'
          + 'color:var(--dsw-alias-label-primary,#eef1f5)'
        wallpaperRow.appendChild(wallpaperInput)

        // A picture that fails to load used to leave the glass over nothing —
        // a black window. Now the built-in backdrop stays and the failure is
        // reported right here.
        var wallpaperNote = document.createElement('div')
        wallpaperNote.style.cssText = 'font-size:10px;min-height:13px;margin:-4px 0 5px 52px;'
          + 'color:var(--dsw-alias-label-tertiary,#8d949e)'
        root.appendChild(wallpaperNote)

        // Three actions, three buttons, three glyphs. The apply button used to
        // double as "clear" whenever the field was empty — an invisible second
        // behaviour on a control labelled 用. Clearing is its own button now, and
        // the words live in each button's tooltip and aria-label.
        var useButton = iconButton(ICON_CHECK, '用这个地址', function () {
          // A minimal DOM may not carry `.value` at all; never throw on it.
          var raw = wallpaperInput.value
          var url = String(raw === undefined || raw === null ? '' : raw).trim()
          if (url === '') {
            wallpaperNote.textContent = '先填一个图片地址，或用左边的图片按钮选一张'
            return
          }
          wallpaperNote.textContent = '加载中…'
          applyWallpaper(url, function (result) {
            wallpaperNote.textContent = result === 'ok'
              ? '已应用'
              : (result === 'extracted'
                  ? '已应用（这个链接是网页，已从中提取出图片地址）'
                  : (result === 'failed'
                      ? '加载失败（不是图片地址，或远程图片被拦下）——仍用内置背景'
                      : '已应用（未能校验）'))
          })
        })

        var clearButton = iconButton(ICON_CLEAR, '清除壁纸，恢复内置背景', function () {
          applyWallpaper('')
          wallpaperInput.value = ''
          wallpaperNote.textContent = '已清除壁纸，恢复内置背景'
        })

        // A local picture comes through the browser's own file picker: a page
        // cannot read a path, but it can read a file the user chose.
        var picker = document.createElement('input')
        picker.type = 'file'
        picker.accept = 'image/*'
        picker.style.display = 'none'
        picker.addEventListener('change', function () {
          var file = picker.files === undefined || picker.files === null ? null : picker.files[0]
          if (file === undefined || file === null) return
          // The data URL is what gets stored, and storage is a few megabytes.
          if (file.size > 2 * 1024 * 1024) {
            wallpaperNote.textContent = '图片超过 2MB，换一张小一点的（本地存储放不下）'
            return
          }
          if (typeof FileReader !== 'function') {
            wallpaperNote.textContent = '这个环境不支持读取本地文件'
            return
          }
          var reader = new FileReader()
          reader.onload = function () {
            applyWallpaper(String(reader.result), function (result) {
              wallpaperNote.textContent = result === 'ok'
                ? '已应用本地图片：' + file.name
                : '本地图片读取失败'
            })
          }
          reader.onerror = function () {
            wallpaperNote.textContent = '本地图片读取失败'
          }
          reader.readAsDataURL(file)
        })

        var pickButton = iconButton(ICON_IMAGE, '从本机选一张图片', function () {
          try {
            picker.click()
          } catch (error) {
            wallpaperNote.textContent = '无法打开文件选择器'
          }
        })

        wallpaperRow.appendChild(pickButton)
        wallpaperRow.appendChild(useButton)
        wallpaperRow.appendChild(clearButton)
        root.appendChild(picker)
        root.appendChild(wallpaperRow)

        // ---- presets ------------------------------------------------------
        // Three sliders is more knobs than most people want. A preset sets the
        // two that matter, for the scheme currently on screen.
        var presets = document.createElement('div')
        presets.style.cssText = 'display:flex;gap:6px;margin-top:9px'

        var PRESETS = [
          // Calibrated against the REAL three-layer stack: at these multipliers
          // the measured composite lands near 33% / 55% / 67%. The previous
          // 1.6x "厚重" measured 89% — opaque, which reads as "nothing happened".
          { label: '通透', glass: 0.55, wash: 0.10 },
          { label: '标准', glass: 1, wash: null },
          { label: '厚重', glass: 1.3, wash: 0.35 },
        ]
        PRESETS.forEach(function (preset) {
          presets.appendChild(consoleButton(preset.label, function () {
            var mode = schemeOf()
            storeScoped(KEY.glass, mode, String(preset.glass))
            if (preset.wash === null) storeScoped(KEY.wash, mode, null)
            else storeScoped(KEY.wash, mode, String(preset.wash))
            applySurfaceVars()
            restack()
            // In place, not panel(true): a rebuild would re-create the whole
            // console and re-run the diagnosis in the middle of the click.
            syncPanel()
          }))
        })
        root.appendChild(presets)

        // ---- actions ------------------------------------------------------
        var actions = document.createElement('div')
        actions.style.cssText = 'display:flex;gap:6px;margin-top:6px'

        var enabled = readStore(KEY.on, 'on') !== 'off'
        var toggle = consoleButton(enabled ? '关闭皮肤' : '开启皮肤', function () {
          var isOff = document.documentElement.getAttribute('data-dsh-glass-skin') === 'off'
          writeStore(KEY.on, isOff ? 'on' : 'off')
          document.documentElement.setAttribute('data-dsh-glass-skin', isOff ? 'on' : 'off')
          toggle.textContent = isOff ? '关闭皮肤' : '开启皮肤'
          refreshStatus()
        })
        actions.appendChild(toggle)

        var details = document.createElement('pre')
        details.style.cssText = 'display:none;margin:9px 0 0;max-height:200px;overflow:auto;'
          + 'white-space:pre-wrap;word-break:break-word;user-select:text;font-size:10px;line-height:1.45;'
          + 'color:var(--dsw-alias-label-secondary,#a8b0ba)'

        var detailsButton = consoleButton('详情', function () {
          var hidden = details.style.display === 'none'
          if (hidden) {
            details.textContent = JSON.stringify(
              { version: VERSION, diagnose: diagnose(), layers: layers() },
              null,
              2,
            )
          }
          details.style.display = hidden ? 'block' : 'none'
          detailsButton.textContent = hidden ? '收起' : '详情'
        })
        actions.appendChild(detailsButton)

        var resetButton = consoleButton('重置', function () {
          writeStore(KEY.on, null)
          writeStore(KEY.wallpaper, null)
          writeStore(KEY.blur, null)
          // Both schemes, not just the visible one: "reset" should mean reset.
          ;['light', 'dark'].forEach(function (scheme) {
            writeStore(KEY.glass + ':' + scheme, null)
            writeStore(KEY.wash + ':' + scheme, null)
          })
          writeStore(KEY.glass, null)
          writeStore(KEY.wash, null)
          setVar('--dsh-glass-skin-photo', null)
          setVar('--dsh-glass-skin-blur', null)
          setVar('--dsh-glass-skin-wash', null)
          applySurfaceVars()
          restack()
          close()
        })
        // Distinct from the wallpaper's own clear button: this one resets
        // everything, and says so.
        resetButton.title = '恢复全部默认设置（浓度 / 遮罩 / 壁纸 / 开关）'
        resetButton.setAttribute('aria-label', '恢复全部默认设置')
        actions.appendChild(resetButton)

        root.appendChild(actions)
        root.appendChild(details)

        // Publish the references an in-place update needs, then measure and write
        // once: the panel is already on screen while refreshStatus reads the
        // layout, so keeping the reads before the writes matters.
        panelRefs = {
          root: root,
          glass: { input: glassInput, readout: glass.readout },
          blur: { input: blurInput, readout: blur.readout },
          wash: { input: washInput, readout: wash.readout },
          refresh: refreshStatus,
        }

        refreshStatus()
        document.body.appendChild(root)
        syncChipState()
        return root
      } catch (error) {
        return null
      }
    }

    /**
     * One delayed self-check after the layout settles. Silence when healthy;
     * a visible panel plus a console warning when not.
     */
    function scheduleDiagnose() {
      if (typeof setTimeout !== 'function') return
      try {
        setTimeout(function () {
          try {
            var verdict = diagnose()
            if (!verdict.ok) {
              console.warn('[dsh-glass-skin] ' + verdict.reasons.join(' | '))
              panel(true)
            }
          } catch (error) {
            /* the self-check must never be the thing that breaks the page */
          }
        }, 700)
      } catch (error) {
        /* ignore */
      }
    }

    function apply(ctx) {
      try {
        if (typeof document === 'undefined') return

        // Before anything reads a preference: carry over settings saved under
        // the pre-rename namespace, or the rename silently resets them.
        migrateLegacySettings()

        injectCss()
        ensureBackdrop()
        // The chip doubles as the "did my code load at all" indicator: if it is
        // absent, the bundle never reached this page and no styling can explain it.
        ensureChip()

        // --- backdrop controls -------------------------------------------------
        var storedWallpaper = readStore(KEY.wallpaper, null)
        var storedBlur = readStore(KEY.blur, null)
        if (storedWallpaper !== null) {
          // Re-probed on every boot: a picture that has since become unreachable
          // falls back to the built-in backdrop instead of a black window.
          applyWallpaper(storedWallpaper)
        }
        if (storedBlur !== null) setVar('--dsh-glass-skin-blur', storedBlur)
        // The wash is per scheme and is published by applySurfaceVars() below.

        var enabled = readStore(KEY.on, 'on') !== 'off'
        document.documentElement.setAttribute('data-dsh-glass-skin', enabled ? 'on' : 'off')
        setVar('--dsh-glass-skin-on', enabled ? '1' : '0')

        // --- the glass itself --------------------------------------------------
        var theme = themeOf(ctx)
        // Published for the console, which re-stacks the layer on every drag.
        currentTheme = theme === undefined ? null : theme
        applySurfaceVars()

        // The scheme the user picks later must be honoured too: the surfaces are
        // published per scheme, so a flip has to recompute them.
        if (ctx !== null && ctx !== undefined && typeof ctx.on === 'function') {
          try {
            ctx.on('theme/change', function () {
              applySurfaceVars()

              // Force: switching scheme makes the presenter re-publish its own
              // token map, which REPLACES the layer we registered — even when our
              // values happen to be unchanged — and it publishes those tokens as
              // important inline declarations, so no stylesheet can win them
              // back. Skipping this leaves the four surface tokens opaque
              // (measured on a real install: 1 layer, 100%) until something else
              // restacks. This used to take a preset click by hand.
              restackForSchemeSwitch()

              // The console edits the active scheme, so it has to follow a flip —
              // in place, because rebuilding it here costs a full diagnosis on
              // top of the presenter's own re-render.
              syncPanel()
            })
          } catch (error) {
            /* a missing event surface is not fatal */
          }
        }

        if (theme !== undefined && theme !== null && typeof theme.overrideTokens === 'function') {
          // Wrapped individually: a theme service that rejects the layer must
          // still leave a working backdrop, a working stylesheet and a working
          // control surface. The stylesheet forces the same tokens anyway.
          try {
            var firstPairs = stackTokens()
            disposeTokens = theme.overrideTokens(NS, firstPairs)
            // Record it, or the first later restack re-registers values the
            // presenter already holds — a whole extra re-render for nothing.
            registeredPairs = JSON.stringify(firstPairs)
          } catch (error) {
            disposeTokens = null
            console.warn('[dsh-glass-skin] the theme service refused the token layer: ' + error)
          }

          // The colour scheme is the user's, not the skin's. v0.3 called
          // `setTheme('dark')` here and left a light-mode user in a broken dark
          // UI; the skin now follows whichever scheme is active and changes
          // nothing. Read only, and only for the report.
          try {
            var snapshot = typeof theme.getTheme === 'function' ? theme.getTheme() : null
            var scheme = snapshot && snapshot.active ? snapshot.active.colorScheme : null
            if (scheme !== null && scheme !== undefined && scheme !== 'dark' && scheme !== 'light') {
              console.warn('[dsh-glass-skin] unexpected colour scheme: ' + scheme)
            }
          } catch (error) {
            /* a report-only read must never matter */
          }
        } else {
          console.warn('[dsh-glass-skin] theme service unavailable — the stylesheet carries the glass on its own')
        }

        // --- the control surface ----------------------------------------------
        window.__dshGlassSkin = {
          version: VERSION,
          tokens: SURFACE_TOKENS,
          backdrop: DEFAULT_BACKDROP,

          /** What actually reached the page. Paste this when reporting a problem. */
          probe: probe,

          /** Whether the glass took, and why not when it did not. */
          diagnose: diagnose,

          /** Show (or `panel(false)` hide) the on-page diagnostic panel. */
          panel: panel,

          /** Which element actually paints what, from #root down and at the centre. */
          layers: layers,

          /** Effective opacity of the stacked fills; exposed so it can be tested. */
          compositeAlpha: compositeAlpha,

          /** Multiply one colour's alpha; exposed so it can be tested. */
          scaleAlpha: scaleAlpha,

          /** Glass strength from a script: 1 = shipped, 0 = invisible, 2 = solid. */
          glass: function (multiplier) {
            storeScoped(KEY.glass, schemeOf(), String(multiplier))
            applySurfaceVars()
            restack()
          },

          /**
           * Turn the skin off without unloading the plugin.
           *
           * @param persist - `false` switches it off for this load only. The
           *   preview harness needs that: every `file://` page shares one
           *   origin, so a persisted "off" from a comparison run would silently
           *   disable the skin in every later load (this cost a debugging round).
           */
          off: function (persist) {
            if (persist !== false) writeStore(KEY.on, 'off')
            document.documentElement.setAttribute('data-dsh-glass-skin', 'off')
            setVar('--dsh-glass-skin-on', '0')
            if (disposeTokens !== null) {
              try {
                disposeTokens()
              } catch (error) {
                /* ignore */
              }
              disposeTokens = null
            }
          },

          /** Turn it back on. `on(false)` applies it without persisting. */
          on: function (persist) {
            if (persist !== false) writeStore(KEY.on, 'on')
            document.documentElement.setAttribute('data-dsh-glass-skin', 'on')
            setVar('--dsh-glass-skin-on', '1')
            ensureBackdrop()
            if (disposeTokens === null && theme !== undefined && theme !== null && typeof theme.overrideTokens === 'function') {
              try {
                disposeTokens = theme.overrideTokens(NS, stackTokens())
              } catch (error) {
                disposeTokens = null
              }
            }
          },

          /** Use a picture as the backdrop; pass '' to go back to the built-in one. */
          wallpaper: function (url) {
            applyWallpaper(url)
          },

          /** Backdrop blur radius, e.g. `.blur('72px')` or `.blur('0')`. */
          blur: function (value) {
            writeStore(KEY.blur, value)
            setVar('--dsh-glass-skin-blur', value)
          },

          /** Wash strength 0–1, e.g. `.wash(0.5)`. */
          wash: function (alpha) {
            writeStore(KEY.wash, String(alpha))
            setVar('--dsh-glass-skin-wash', 'rgba(10,12,16,' + alpha + ')')
          },

          /** Forget every stored preference and return to the built-in look. */
          reset: function () {
            writeStore(KEY.on, null)
            writeStore(KEY.wallpaper, null)
            writeStore(KEY.blur, null)
            writeStore(KEY.wash, null)
            setVar('--dsh-glass-skin-photo', null)
            setVar('--dsh-glass-skin-blur', null)
            setVar('--dsh-glass-skin-wash', null)
          },
        }

        // Self-report once the layout has settled: silent when healthy.
        scheduleDiagnose()
      } catch (error) {
        // A skin that breaks the UI is far worse than a skin that does nothing.
        console.error('[dsh-glass-skin] apply failed: ' + error)
      }
    }

    exports.name = NS
    exports.inject = ['theme']
    exports.apply = apply
    return module.exports
  },
})
