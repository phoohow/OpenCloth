export const INTEGRATE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  gravity: vec3<f32>,
  _p0: f32,
  windDir: vec3<f32>,
  windSpeed: f32,
  damping: f32,
  time: f32,
  maxSpeed: f32,
  _p1: f32,
  grabForce: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;
@group(0) @binding(5) var<storage, read> grabWeight: array<f32>;

@compute @workgroup_size(256)
fn integrate(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let pos = posInvMass[i];
  let vel = velocity[i];
  let invMass = pos.w;

  prevPos[i] = pos;

  if (invMass == 0.0) {
    predicted[i] = pos;
    return;
  }

  var accel = params.gravity;
  let windPhase = sin(params.time * 2.0 + f32(i) * 0.013);
  accel = accel + params.windDir * params.windSpeed * (1.0 + 0.3 * windPhase);

  let weight = grabWeight[i];
  if (params.grabForce.w > 0.0 && weight > 0.0) {
    accel = accel + params.grabForce.xyz * (weight * invMass);
  }

  let dt = params.dt;
  var pred = pos.xyz + vel.xyz * dt + accel * dt * dt;

  predicted[i] = vec4<f32>(pred, 0.0);
}
`;
