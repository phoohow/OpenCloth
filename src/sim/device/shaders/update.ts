export const UPDATE_WGSL = /* wgsl */`
struct SimParams {
  dt: f32,
  particleCount: u32,
  maxSpeed: f32,
  _p0: f32,
};

@group(0) @binding(0) var<storage, read_write> posInvMass: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> prevPos: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: SimParams;
@group(0) @binding(5) var<storage, read> particleDamping: array<f32>;

@compute @workgroup_size(256)
fn updateVelocity(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let prev = prevPos[i];
  let pred = predicted[i];
  let invMass = prev.w;
  if (invMass == 0.0) { return; }

  var vel = (pred.xyz - prev.xyz) / params.dt;
  vel = vel * (1.0 - particleDamping[i]);
  let speed = length(vel);
  if (speed > params.maxSpeed) { vel = vel / speed * params.maxSpeed; }

  velocity[i] = vec4<f32>(vel, 0.0);
  posInvMass[i] = vec4<f32>(pred.xyz, invMass);
}
`;
