/**
 * SceneIR — the versioned, JSON-serializable scene document that is the
 * handshake between @lumen/codegen (producer), generated entry modules
 * (transport), and @lumen/runtime (consumer). Single owner: contracts.
 *
 * Wire format (frozen): `version: 1` and the JSON shape
 * `site/template/theme/nodes/tracks/bindings/assets/hydration/a11y`.
 * Changing this shape requires bumping SCENE_IR_VERSION and a coordinated
 * update of codegen's lowering and runtime's raising.
 */
/** Current SceneIR schema version. */
export const SCENE_IR_VERSION = 1;
