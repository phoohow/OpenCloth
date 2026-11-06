/** Version counters of the scene, compared by the path tracer instead of string signatures. */

/** Counters that change exactly when the geometry or materials the tracer holds change. */
export interface SceneRevisions {
  /** Objects added or removed, or an index buffer replaced. */
  topology: number;
  /** A material was swapped on a traced object. */
  material: number;
  /** A traced object moved. */
  transform: number;
  /** An object was shown or hidden, or its trace mask changed. */
  visibility: number;
  /** A geometry's group ranges changed, e.g. a hidden panel left the draw list. */
  groups: number;
  /** Vertex positions were written, e.g. a cloth frame or a posed body. */
  deform: number;
}

/** Fresh counters for a new scene. */
export function createRevisions(): SceneRevisions {
  return { topology: 0, material: 0, transform: 0, visibility: 0, groups: 0, deform: 0 };
}
