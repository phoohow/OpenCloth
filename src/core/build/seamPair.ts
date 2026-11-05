/** One merged particle pair stitched together, by a seam or by a closing dart. */
export interface SeamPair {
  p0: number;
  p1: number;
  /** Gap between the pair in the initial layout, in meters. */
  open: number;
  /** Seam record the pair belongs to, or the dart record when it stitches dart legs. */
  seamId: string;
  /** Dart whose two legs the pair stitches; set instead of a seam pairing. */
  dartId?: string;
}
