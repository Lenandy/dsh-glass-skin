/**
 * Validates this package's manifest against the declaration rules the host
 * actually enforces, read from `@deepseek-ai/dsh-client-modules`
 * (`parseDshClient`) and from the shipped plugin-authoring template at
 * `@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration`.
 *
 * Why this exists: the host rejects a malformed declaration *loudly* at boot,
 * but a **missing** field fails silently in the worst possible way — the bundle
 * simply never materializes and the plugin looks like it did nothing. That is
 * exactly how `dsh.client.immediately` was missed: a pure-decoration plugin
 * offers no surface for anything to "use", so without `immediately: true` the
 * lazy loader has no reason to ever run it.
 *
 *   node test/manifest.test.mjs
 */
import { readFileSync, statSync } from 'node:fs'
import assert from 'node:assert/strict'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

// ---------------------------------------------- the rules the host applies ---

{
  assert.equal(typeof pkg.name, 'string')
  assert.equal(pkg.type, 'module', 'the host imports the halves as ESM')

  const dsh = pkg.dsh
  assert.equal(typeof dsh, 'object')
  assert.equal(dsh !== null, true)

  // dsh.bundle.patch — the composition layer that inserts the Loader entry.
  assert.equal(typeof dsh.bundle?.patch, 'string', 'dsh.bundle.patch must be declared')
  assert.equal(dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.exports?.['./cordis.patch.yml'] !== undefined, 'the patch must be exported')

  // dsh.client — parsed by parseDshClient; each field's rule is exact.
  const client = dsh.client
  assert.equal(typeof client, 'object', 'dsh.client must be an object')
  assert.equal(typeof client.platform, 'string', 'dsh.client.platform must be a string')
  assert.equal(client.platform, 'web', 'the harness web GUI is the web platform')

  assert.equal(
    typeof client.immediately,
    'boolean',
    'dsh.client.immediately must be a boolean when present',
  )
  assert.equal(
    client.immediately,
    true,
    'a plugin with no UI surface must load immediately, or the lazy loader never runs it',
  )

  assert.ok(Array.isArray(client.inject), 'dsh.client.inject must be a string array')
  for (const entry of client.inject) assert.equal(typeof entry, 'string')
}

// ------------------------------------------------------- the client bundle ---

{
  assert.equal(typeof pkg.exports?.['./client'], 'string', 'the bundle must be exported')
  assert.equal(pkg.exports['./client'], './lib/client.js')

  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  // The factory registers under the package name, and the host resolves
  // `<id>/client` to the same exports.
  assert.ok(bundle.includes('__ModuleLoader__'), 'a client bundle registers through the module loader')
  assert.ok(
    bundle.includes(`id: '${pkg.name}'`),
    'the registered id must equal the package name',
  )

  const host = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(host.includes('export'), 'the host half is an ES module')
}

// ------------------------------------------------------------- the patch ---

{
  // The patch inserts one entry whose name resolves to this package, and the
  // package must be resolvable from the profile that declares the bundle.
  assert.ok(patch.includes('insert:'), 'the patch inserts the Loader entry')
  assert.ok(
    patch.includes(`'${pkg.name}'`) || patch.includes(`"${pkg.name}"`),
    'the inserted entry must name this package',
  )
  // `private: true` comes from the official local-development template and only
  // blocks `npm publish`. A package meant to be installed by name must not
  // carry it.
  assert.notEqual(pkg.private, true, 'a distributed package must not be private')

  // A published plugin is expected to state its license, and the ecosystem
  // list flags repositories without one.
  assert.equal(pkg.license, 'MIT')
  assert.ok(
    readFileSync(new URL('../LICENSE', import.meta.url), 'utf8').includes('MIT License'),
    'the LICENSE file must ship with the license the manifest declares',
  )
}

// ------------------------------------------- publishable display metadata ---

{
  // Plugin Manager cards, bundle details, component rows and the Settings
  // inventory read these WITHOUT activating the plugin, so a missing title or
  // icon silently degrades to fallback artwork. They are read from the installed
  // package, which is why the icon has to be a real file inside it.
  const icon = pkg.icon
  assert.equal(typeof icon, 'string', 'the manager reads a top-level icon')
  assert.ok(icon.startsWith('./'), 'icon must be a path relative to the manifest')
  assert.ok(!/^[a-z]+:/i.test(icon), 'icon must not be a URL')
  assert.ok(/\.(svg|png|jpe?g|webp)$/i.test(icon), 'icon must be an accepted image format')

  const iconBytes = statSync(new URL('../' + icon.replace(/^\.\//, ''), import.meta.url)).size
  assert.ok(iconBytes > 0, 'the icon must exist and not be empty')
  assert.ok(iconBytes <= 256 * 1024, 'the manager rejects an icon over 256 KiB')

  assert.equal(typeof pkg.meta?.title, 'string', 'meta.title is the card title')
  assert.ok(pkg.meta.title.length > 0)
  assert.equal(typeof pkg.meta?.description, 'string')
  assert.ok(pkg.meta.description.length > 0)

  // locale/*.json is the documented mechanism and the inline `meta` is the
  // fallback: they must not drift apart.
  const en = JSON.parse(readFileSync(new URL('../locale/en.json', import.meta.url), 'utf8'))
  const zh = JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8'))
  assert.equal(en.title, pkg.meta.title, 'locale/en.json must match the inline fallback')
  assert.equal(en.description, pkg.meta.description)
  assert.ok(zh.title.length > 0 && zh.description.length > 0, 'a Chinese card is provided too')

  // Both must ship and be exported, or an npm install loses the card's text and
  // artwork.
  for (const entry of ['icon.svg', 'locale/*.json']) {
    assert.ok(pkg.files.includes(entry), `files must ship ${entry}`)
  }
  assert.ok(pkg.exports['./locale/*.json'] !== undefined, 'the locale files must be exported')
}

console.log('dsh-glass-skin: manifest contract OK')
