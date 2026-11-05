/**
 * Version of the `.ocproj.json` format, kept next to the model types because the
 * document schema and this number change together.
 */

/** Version written by this build. Bump it whenever a change makes older readers wrong. */
export const PROJECT_FORMAT_VERSION = 1;

/** Version assumed for files written before the field existed. */
export const LEGACY_PROJECT_FORMAT_VERSION = 0;
