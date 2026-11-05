/**
 * The core data model, split by domain and re-exported from one path.
 *
 * Imports stay `from '../model/types'` everywhere; the split only decides which module owns a
 * type, so a reader can start from the domain they care about instead of scrolling 700 lines.
 * Dependencies point one way: `geometry` ← `fabric` / `pattern` ← `avatar` / `scene` / `size`
 * ← `project`. Nothing here imports anything outside `core/model`.
 */
export * from './geometry';
export * from './pattern';
export * from './fabric';
export * from './avatar';
export * from './scene';
export * from './size';
export * from './project';
