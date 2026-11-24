export const SOLVE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  constraintCount: u32,
  _p0: f32,
  _p1: vec3<f32>,
  _p2: f32,
};

struct Constraint {
  p0: u32,
  p1: u32,
  restLength: f32,
  compliance: f32,
};

@group(0) @binding(0) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> posInvMass: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> constraints: array<Constraint>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn solve(@builtin(global_invocation_id) gid: vec3<u32>) {
  let ci = gid.x;
  if (ci >= params.constraintCount) { return; }

  let c = constraints[ci];
  let w0 = posInvMass[c.p0].w;
  let w1 = posInvMass[c.p1].w;
  let wSum = w0 + w1;
  if (wSum == 0.0) { return; }

  let p0 = predicted[c.p0].xyz;
  let p1 = predicted[c.p1].xyz;
  let delta = p1 - p0;
  let dist = length(delta);
  if (dist < 1e-7) { return; }

  let alpha = c.compliance;
  let diff = (dist - c.restLength) / (dist * (wSum + alpha));
  let correction = delta * diff;

  predicted[c.p0] = vec4<f32>(p0 + correction * w0, 0.0);
  predicted[c.p1] = vec4<f32>(p1 - correction * w1, 0.0);
}
`;
