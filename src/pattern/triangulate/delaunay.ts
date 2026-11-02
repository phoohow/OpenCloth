/** True when `d` lies inside the circumcircle of the counter-clockwise triangle `a, b, c`. */
function inCircumcircle(
  px: Float64Array, py: Float64Array, a: number, b: number, c: number, d: number,
): boolean {
  const dx = px[d]!, dy = py[d]!;
  const adx = px[a]! - dx, ady = py[a]! - dy;
  const bdx = px[b]! - dx, bdy = py[b]! - dy;
  const cdx = px[c]! - dx, cdy = py[c]! - dy;
  return (
    (adx * adx + ady * ady) * (bdx * cdy - bdy * cdx)
    - (bdx * bdx + bdy * bdy) * (adx * cdy - ady * cdx)
    + (cdx * cdx + cdy * cdy) * (adx * bdy - ady * bdx)
  ) > 0;
}

/**
 * Delaunay triangulation of a flat [x0, y0, x1, y1, ...] point set, by Bowyer-Watson insertion.
 * Returns counter-clockwise index triples in a flat array, without the surrounding super triangle.
 * Input points are expected to be distinct and free of duplicate coordinates.
 *
 * Each point is inserted from the triangle found by walking across shared edges from the previous
 * insertion, and the cavity only visits the removed triangles' neighbours. Walking and the local
 * cavity keep one insertion near O(1) instead of scanning every triangle, which matters because
 * pattern pieces carry thousands of lattice seeds.
 */
export function delaunayTriangulate(points: ArrayLike<number>): number[] {
  const count = points.length >> 1;
  if (count < 3) return [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = points[i * 2]!, y = points[i * 2 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Three extra vertices form a triangle that contains every input point.
  const px = new Float64Array(count + 3);
  const py = new Float64Array(count + 3);
  for (let i = 0; i < count; i++) {
    px[i] = points[i * 2]!;
    py[i] = points[i * 2 + 1]!;
  }
  const reach = Math.max(maxX - minX, maxY - minY, 1e-6) * 20;
  const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
  px[count] = midX - reach;
  py[count] = midY - reach;
  px[count + 1] = midX + reach;
  py[count + 1] = midY - reach;
  px[count + 2] = midX;
  py[count + 2] = midY + reach;

  const stride = count + 3;
  const triangles: number[] = [count, count + 1, count + 2];
  const alive: number[] = [1];
  // Directed edge u→v of a live triangle, keyed by u * stride + v.
  const edges = new Map<number, number>();

  const edgeKey = (u: number, v: number): number => u * stride + v;

  const register = (triangle: number): void => {
    const base = triangle * 3;
    edges.set(edgeKey(triangles[base]!, triangles[base + 1]!), triangle);
    edges.set(edgeKey(triangles[base + 1]!, triangles[base + 2]!), triangle);
    edges.set(edgeKey(triangles[base + 2]!, triangles[base]!), triangle);
  };

  const unregister = (triangle: number): void => {
    const base = triangle * 3;
    const a = triangles[base]!, b = triangles[base + 1]!, c = triangles[base + 2]!;
    if (edges.get(edgeKey(a, b)) === triangle) edges.delete(edgeKey(a, b));
    if (edges.get(edgeKey(b, c)) === triangle) edges.delete(edgeKey(b, c));
    if (edges.get(edgeKey(c, a)) === triangle) edges.delete(edgeKey(c, a));
  };

  register(0);
  let last = 0;

  const orient = (a: number, b: number, p: number): number =>
    (px[b]! - px[a]!) * (py[p]! - py[a]!) - (py[b]! - py[a]!) * (px[p]! - px[a]!);

  /** Walks from `last` to the triangle that contains point `p`, or -1 when the walk stalls. */
  const locate = (p: number): number => {
    let triangle = last;
    const maxSteps = triangles.length + 8;
    for (let step = 0; step < maxSteps; step++) {
      const base = triangle * 3;
      const a = triangles[base]!, b = triangles[base + 1]!, c = triangles[base + 2]!;
      if (orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0) return triangle;
      let next = -1;
      if (orient(a, b, p) < 0) next = edges.get(edgeKey(b, a)) ?? -1;
      else if (orient(b, c, p) < 0) next = edges.get(edgeKey(c, b)) ?? -1;
      else next = edges.get(edgeKey(a, c)) ?? -1;
      if (next < 0 || next === triangle) return -1;
      triangle = next;
    }
    return -1;
  };

  /** Linear fallback over live triangles, used only when the walk leaves the hull numerically. */
  const locateLinear = (p: number): number => {
    for (let triangle = 0; triangle < alive.length; triangle++) {
      if (alive[triangle] === 0) continue;
      const base = triangle * 3;
      const a = triangles[base]!, b = triangles[base + 1]!, c = triangles[base + 2]!;
      if (orient(a, b, p) >= 0 && orient(b, c, p) >= 0 && orient(c, a, p) >= 0) return triangle;
    }
    return -1;
  };

  for (let point = 0; point < count; point++) {
    if (!Number.isFinite(px[point]!) || !Number.isFinite(py[point]!)) continue;
    let start = locate(point);
    if (start < 0) start = locateLinear(point);
    if (start < 0) continue;

    // Directed edges of the cavity. An edge shared by two removed triangles cancels against its
    // reverse, so what is left runs counter-clockwise around the hole and connects to the new point.
    const cavity = new Map<number, number>();
    const removed: number[] = [];
    const visited = new Set<number>();
    const stack = [start];
    while (stack.length > 0) {
      const triangle = stack.pop()!;
      if (alive[triangle] === 0 || visited.has(triangle)) continue;
      visited.add(triangle);
      const base = triangle * 3;
      const a = triangles[base]!, b = triangles[base + 1]!, c = triangles[base + 2]!;
      if (!inCircumcircle(px, py, a, b, c, point)) continue;
      alive[triangle] = 0;
      removed.push(triangle);

      const addEdge = (u: number, v: number): void => {
        const reverse = edgeKey(v, u);
        if (cavity.delete(reverse)) return;
        cavity.set(edgeKey(u, v), v);
      };
      addEdge(a, b);
      addEdge(b, c);
      addEdge(c, a);

      const neighbourAB = edges.get(edgeKey(b, a));
      if (neighbourAB !== undefined && neighbourAB !== triangle) stack.push(neighbourAB);
      const neighbourBC = edges.get(edgeKey(c, b));
      if (neighbourBC !== undefined && neighbourBC !== triangle) stack.push(neighbourBC);
      const neighbourCA = edges.get(edgeKey(a, c));
      if (neighbourCA !== undefined && neighbourCA !== triangle) stack.push(neighbourCA);
    }

    for (const triangle of removed) unregister(triangle);

    let created = -1;
    for (const [key, v] of cavity) {
      const u = Math.floor(key / stride);
      const triangle = triangles.length / 3;
      triangles.push(u, v, point);
      alive.push(1);
      register(triangle);
      created = triangle;
    }
    if (created >= 0) last = created;
  }

  const out: number[] = [];
  for (let slot = 0; slot < triangles.length; slot += 3) {
    if (alive[slot / 3] === 0) continue;
    const a = triangles[slot]!, b = triangles[slot + 1]!, c = triangles[slot + 2]!;
    if (a >= count || b >= count || c >= count) continue;
    out.push(a, b, c);
  }
  return out;
}
