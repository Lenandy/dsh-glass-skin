/**
 * dsh-glass-skin host half.
 *
 * The skin is purely a browser-side concern: it registers token overrides and
 * injects a stylesheet, both of which live in the client bundle. There is
 * nothing for the Host to own, so this entry exists only to carry the bundle
 * patch layer and to mirror the shipped `ui-*` packages' shape.
 *
 * It deliberately declares no `inject` and does no work, so it cannot fail a
 * composition no matter which other plugins are present.
 */

export const name = 'dsh-glass-skin'

/** No-op: the browser half does all the work. */
export function apply() {}
