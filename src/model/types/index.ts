/**
 * The core data model, split by domain and re-exported from one path.
 *
 * Imports stay `from '../model/types'` everywhere; the split only decides which module owns a
 * type, so a reader can start from the domain they care about instead of scrolling 700 lines.
 * Dependencies point one way: `geometry` ← `fabric` / `pattern` ← `avatar` / `scene` / `size`
 * ← `project`. Nothing here imports anything outside `core/model`.
 */
export * from '@/model/types/geometry';
export * from '@/model/types/pattern';
export * from '@/model/types/fabric';
export * from '@/model/types/avatar';
export * from '@/model/types/scene';
export * from '@/model/types/size';
export * from '@/model/types/project';
export * from '@/model/types/command';
