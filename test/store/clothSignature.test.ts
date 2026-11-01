import { describe, expect, it } from 'vitest';
import { computeClothSignature } from '../../src/store/projectStore';
import { panelGeometrySignature } from '../../src/core/engine/clothSignatures';
import { createDefaultProject, createEmptyPattern } from '../../src/core/model/defaults';
import { vec2, vec3, type Pattern, type Project } from '../../src/core/model/types';

/** Square panel with one seam, one notch, one note and one measurement. */
function makePattern(): Pattern {
  const pattern = createEmptyPattern();
  const corners = [vec2(0, 0), vec2(20, 0), vec2(20, 30), vec2(0, 30)];
  corners.forEach((pos, index) => {
    pattern.points[`p${index}`] = { id: `p${index}`, pos };
  });
  for (let index = 0; index < corners.length; index++) {
    pattern.edges[`e${index}`] = {
      id: `e${index}`,
      type: 'line',
      startPointId: `p${index}`,
      endPointId: `p${(index + 1) % corners.length}`,
    };
  }
  pattern.panels.panel_a = {
    id: 'panel_a',
    name: '前片',
    outlineEdgeIds: ['e0', 'e1', 'e2', 'e3'],
    dartIds: [],
    internalLineIds: [],
    seamAllowanceCm: 1,
    fabricId: 'cotton',
    meshResolutionCm: 2,
    visible: true,
    locked: false,
  };
  pattern.seams.seam_1 = {
    id: 'seam_1',
    type: 'normal',
    a: { edgeId: 'e0', t0: 0, t1: 0.5 },
    b: { edgeId: 'e2', t0: 0.5, t1: 1 },
    flip: false,
    strength: 1,
    threadColor: '#ffffff',
    stitchVisible: true,
  };
  pattern.notches.n1 = { id: 'n1', edgeId: 'e0', t: 0.5 };
  pattern.annotations.a1 = { id: 'a1', panelId: 'panel_a', text: '备注', pos: vec2(1, 1) };
  pattern.measurements.m1 = {
    id: 'm1',
    panelId: 'panel_a',
    kind: 'distance',
    refs: { pointAId: 'p0', pointBId: 'p1' },
  };
  return pattern;
}

function makeProject(): Project {
  const project = createDefaultProject('签名测试');
  project.pattern = makePattern();
  return project;
}

function expectRebuild(mutate: (project: Project) => void): void {
  const project = makeProject();
  const before = computeClothSignature(project);
  mutate(project);
  expect(computeClothSignature(project)).not.toBe(before);
}

function expectNoRebuild(mutate: (project: Project) => void): void {
  const project = makeProject();
  const before = computeClothSignature(project);
  mutate(project);
  expect(computeClothSignature(project)).toBe(before);
}

/** Simulates a field the record type does not declare yet. */
function withExtraField<T extends object>(record: T, key: string, value: unknown): T {
  return { ...record, [key]: value } as T;
}

describe('computeClothSignature draw-only fields', () => {
  it('keeps the signature when names of pattern objects change', () => {
    expectNoRebuild(project => {
      project.pattern.panels.panel_a.name = '后片';
      project.pattern.points.p0.name = '肩点';
      project.pattern.edges.e0.name = '下摆';
      project.pattern.seams.seam_1.name = '侧缝';
      project.pattern.notches.n1.name = '剪口 A';
      project.pattern.annotations.a1.name = '说明';
      project.pattern.measurements.m1.name = '胸围';
    });
  });

  it('keeps the signature when panel visibility and seam stitch visibility toggle', () => {
    expectNoRebuild(project => {
      project.pattern.panels.panel_a.visible = false;
      project.pattern.seams.seam_1.stitchVisible = false;
    });
  });

  it('keeps the signature when the avatar name, display mode and transform change', () => {
    expectNoRebuild(project => {
      project.avatar.name = '模特 A';
      project.avatar.display = 'hidden';
      project.avatar.transform = {
        position: vec3(1, 0, 0),
        rotationEuler: vec3(0, 0.5, 0),
        scale: vec3(1, 1, 1),
      };
    });
  });

  it('keeps the signature when project meta changes', () => {
    expectNoRebuild(project => {
      project.meta.name = '另一份工程';
      project.meta.modifiedAt = '2026-01-01T00:00:00.000Z';
    });
  });
});

describe('computeClothSignature rebuild fields', () => {
  it('changes the signature when a panel transform changes', () => {
    expectRebuild(project => {
      project.pattern.panels.panel_a.transform = {
        position: vec3(0, 0.1, 0),
        rotationEuler: vec3(0, 0, 0),
        scale: vec3(1, 1, 1),
      };
    });
  });

  it('changes the signature when a point moves', () => {
    expectRebuild(project => {
      project.pattern.points.p0.pos = vec2(-1, 0);
    });
  });

  it('changes the signature when a bezier handle moves', () => {
    expectRebuild(project => {
      project.pattern.points.p0.handleOut = { x: 2, y: 2 };
    });
  });

  it('changes the signature when an edge type or its arc geometry changes', () => {
    expectRebuild(project => {
      project.pattern.edges.e0.type = 'bezier';
    });
    expectRebuild(project => {
      project.pattern.edges.e0.type = 'arc';
      project.pattern.edges.e0.arc = {
        center: vec2(10, 15),
        radius: 5,
        startAngle: 0,
        endAngle: Math.PI / 2,
        ccw: true,
      };
    });
    expectRebuild(project => {
      project.pattern.edges.e0.arc = {
        center: vec2(10, 15),
        radius: 6,
        startAngle: 0,
        endAngle: Math.PI / 2,
        ccw: true,
      };
    });
  });

  it('changes the signature when a seam interval, anchor, type or strength changes', () => {
    expectRebuild(project => {
      project.pattern.seams.seam_1.a.t0 = 0.1;
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.a.t1 = 0.4;
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.a.anchorT = 0.25;
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.b.edgeId = 'e3';
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.type = 'gather';
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.gatherRatio = 0.5;
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.flip = true;
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1.strength = 0.5;
    });
  });

  it('changes the signature when avatar measurements or the body source change', () => {
    expectRebuild(project => {
      project.avatar.params.chestCm = 100;
    });
    expectRebuild(project => {
      project.avatar.params.poseArmAngleRad = 0.3;
    });
    expectRebuild(project => {
      project.avatar.params.poseLegSpreadRad = 0.2;
    });
    expectRebuild(project => {
      project.avatar.params.poseTorsoLeanRad = 0.1;
    });
    expectRebuild(project => {
      project.avatar.source = 'procedural';
    });
    expectRebuild(project => {
      project.avatar.glbUrl = '/models/other.glb';
    });
  });

  it('changes the signature when the global or per-panel mesh resolution changes', () => {
    expectRebuild(project => {
      project.scene.simulation.meshResolutionCm = 1;
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.meshResolutionCm = 4;
    });
  });

  it('keeps a per-panel mesh density change local to that panel', () => {
    const project = makeProject();
    project.pattern.panels.panel_b = { ...project.pattern.panels.panel_a, id: 'panel_b', name: '后片' };
    const beforeA = panelGeometrySignature(project, 'panel_a');
    const beforeB = panelGeometrySignature(project, 'panel_b');

    project.pattern.panels.panel_a.meshResolutionCm = 4;
    expect(panelGeometrySignature(project, 'panel_a')).not.toBe(beforeA);
    expect(panelGeometrySignature(project, 'panel_b')).toBe(beforeB);
  });

  it('changes the signature when panel structure fields change', () => {
    expectRebuild(project => {
      project.pattern.panels.panel_a.seamAllowanceCm = 2;
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.fabricId = 'silk';
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.outlineEdgeIds = ['e0', 'e1', 'e2'];
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.holes = [['e0']];
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.grainAngleDeg = 45;
    });
    expectRebuild(project => {
      project.pattern.panels.panel_a.drape = { region: 'torso', sweepDeg: 180 };
    });
    expectRebuild(project => {
      project.pattern.panels.panel_b = { ...project.pattern.panels.panel_a, id: 'panel_b' };
    });
  });

  it('changes the signature when a seam is added or removed', () => {
    expectRebuild(project => {
      project.pattern.seams.seam_2 = { ...project.pattern.seams.seam_1, id: 'seam_2' };
    });
    expectRebuild(project => {
      delete project.pattern.seams.seam_1;
    });
  });

  it('is unchanged for a structural clone of the same project', () => {
    const project = makeProject();
    expect(computeClothSignature(structuredClone(project))).toBe(computeClothSignature(project));
  });
});

describe('computeClothSignature other subsystem fields', () => {
  it('keeps the signature when fabric appearance, physics or name change', () => {
    expectNoRebuild(project => {
      const fabric = Object.values(project.fabrics)[0];
      fabric.appearance.baseColor = '#112233';
      fabric.appearance.roughness = 0.1;
      fabric.appearance.maps.normal = 'normal.png';
      fabric.physics.massPerArea = 500;
      fabric.physics.bendingStiffness = 0.9;
      fabric.name = '改名面料';
    });
  });

  it('keeps the signature when lights or the environment light change', () => {
    expectNoRebuild(project => {
      const light = project.scene.lights.lights[0];
      light.intensity = 9;
      light.color = '#ff0000';
      light.enabled = false;
      project.scene.lights.iblEnabled = false;
      project.scene.lights.iblIntensity = 0.2;
      project.scene.lights.iblUrl = '/env/other.hdr';
    });
  });

  it('keeps the signature when render mode, tone mapping or ray tracing settings change', () => {
    expectNoRebuild(project => {
      project.scene.render.mode = 'raytraced';
      project.scene.render.toneMapping = 'none';
      project.scene.render.rayTracing!.maxSamples = 64;
      project.scene.render.rayTracing!.denoise = false;
    });
  });

  it('keeps the signature when solver runtime settings change', () => {
    expectNoRebuild(project => {
      project.scene.simulation.gravity = vec3(0, 0, 0);
      project.scene.simulation.wind = { direction: vec3(0, 0, 1), speed: 5 };
      project.scene.simulation.dt = 1 / 120;
      project.scene.simulation.substeps = 2;
      project.scene.simulation.constraintIterations = 10;
      project.scene.simulation.avatarCollision = false;
    });
  });

  it('keeps the signature when reference objects change', () => {
    expectNoRebuild(project => {
      project.scene.referenceObjects = [{ id: 'r1', name: '参考图', visible: true, opacity: 0.5 }];
    });
  });
});

describe('computeClothSignature default classification for new fields', () => {
  it('ignores fields added under the draw-only key names at any depth', () => {
    expectNoRebuild(project => {
      project.pattern.panels.panel_a = withExtraField(project.pattern.panels.panel_a, 'display', 'hidden');
      project.pattern.points.p0 = withExtraField(project.pattern.points.p0, 'stitchVisible', false);
      project.pattern.edges.e0 = withExtraField(project.pattern.edges.e0, 'name', 'invisible');
      project.pattern.seams.seam_1 = withExtraField(project.pattern.seams.seam_1, 'visible', false);
    });
  });

  it('counts fields added under any other key name', () => {
    expectRebuild(project => {
      project.pattern.panels.panel_a = withExtraField(project.pattern.panels.panel_a, 'renderOrder', 3);
    });
    expectRebuild(project => {
      project.pattern.seams.seam_1 = withExtraField(project.pattern.seams.seam_1, 'threadWidth', 2);
    });
  });

  it('ignores draw-only production markings and lock state', () => {
    expectNoRebuild(project => {
      project.pattern.panels.panel_a.locked = true;
    });
    expectNoRebuild(project => {
      project.pattern.notches.n1.t = 0.4;
    });
    expectNoRebuild(project => {
      project.pattern.annotations.a1.text = '新备注';
    });
    expectNoRebuild(project => {
      project.pattern.measurements.m1.refs.pointBId = 'p2';
    });
    expectNoRebuild(project => {
      project.pattern.seams.seam_1.threadColor = '#ff0000';
    });
  });
});
