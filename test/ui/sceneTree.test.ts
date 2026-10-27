import { describe, expect, it } from 'vitest';
import {
  AVATAR_NODE_ID, CAMERA_NODE_ID, GARMENT_COLLECTION_ID, LIGHT_COLLECTION_ID,
  REFERENCE_COLLECTION_ID, SEAM_COLLECTION_ID,
  buildSceneTree, findSceneNode, isCollectionVisible, lightNodeId, panelSizeCm, readTransform,
  referenceNodeId, seamLabel, seamNodeId, supportsTransform, writeTransform,
} from '../../src/ui/sceneTree';
import { BUNDLED_AVATARS, createDefaultProject, createLight } from '../../src/core/model/defaults';
import { vec3, type Panel, type Pattern, type Project, type Vec2 } from '../../src/core/model/types';

/** Four-corner rectangle outline with ids `p0..p3` / `e0..e3`. */
function rectPattern(width: number, height: number): Pattern {
  const corners: Vec2[] = [
    { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height },
  ];
  const pattern: Pattern = {
    points: {}, edges: {}, darts: {}, internalLines: {}, panels: {}, seams: {},
  };
  corners.forEach((pos, i) => { pattern.points[`p${i}`] = { id: `p${i}`, pos }; });
  const edgeIds: string[] = [];
  corners.forEach((_, i) => {
    const id = `e${i}`;
    edgeIds.push(id);
    pattern.edges[id] = { id, type: 'line', startPointId: `p${i}`, endPointId: `p${(i + 1) % 4}` };
  });
  const panel: Panel = {
    id: 'panel1', name: '前片', outlineEdgeIds: edgeIds, dartIds: [], internalLineIds: [],
    seamAllowanceCm: 1, fabricId: 'f', meshResolutionCm: 1.5, visible: true, locked: false,
  };
  pattern.panels[panel.id] = panel;
  return pattern;
}

function fixture(): Project {
  const project = createDefaultProject();
  project.pattern = rectPattern(30, 50);
  project.pattern.seams.sA = {
    id: 'sA', type: 'normal', edgeAId: 'e0', edgeBId: 'e2', flipB: true,
    strength: 0.8, threadColor: '#ff4444', stitchVisible: true,
  };
  project.pattern.seams.sB = {
    id: 'sB', type: 'gather', edgeAId: 'e1', edgeBId: 'e3', flipB: false,
    strength: 0.5, threadColor: '#44ff44', stitchVisible: false,
  };
  project.scene.referenceObjects = [
    { id: 'r1', name: '桌子.glb', visible: true, opacity: 0.5 },
    { id: 'r2', name: '椅子.glb', visible: false, opacity: 0.5 },
  ];
  project.scene.lights.lights = [
    { ...createLight('directional', 1), id: 'lKey', name: '主光' },
    { ...createLight('point', 1), id: 'lDot', name: '灯位 1', enabled: false },
  ];
  return project;
}

describe('buildSceneTree', () => {
  it('lists every scene object class under the project root', () => {
    const tree = buildSceneTree(fixture());
    expect(tree.kind).toBe('scene');
    expect(tree.label).toBe(fixture().meta.name);
    expect(tree.children.map(c => c.id)).toEqual([
      GARMENT_COLLECTION_ID, SEAM_COLLECTION_ID, AVATAR_NODE_ID,
      REFERENCE_COLLECTION_ID, LIGHT_COLLECTION_ID, CAMERA_NODE_ID,
    ]);
    const garments = findSceneNode(tree, GARMENT_COLLECTION_ID);
    expect(garments?.children.map(c => c.label)).toEqual(['前片']);
  });

  it('lists every created light with its type, plus the environment row', () => {
    const lights = findSceneNode(buildSceneTree(fixture()), LIGHT_COLLECTION_ID);
    expect(lights?.children.map(c => c.id)).toEqual([lightNodeId('lKey'), lightNodeId('lDot'), '@env']);
    const dot = findSceneNode(buildSceneTree(fixture()), lightNodeId('lDot'));
    expect(dot?.kind).toBe('light');
    expect(dot?.note).toBe('点光源');
    // A disabled light stays in the list and reports itself hidden.
    expect(dot?.visible).toBe(false);
    expect(dot?.hideable).toBe(true);
  });

  it('lists one row per seam under the stitch group', () => {
    const project = fixture();
    const tree = buildSceneTree(project);
    const seams = findSceneNode(tree, SEAM_COLLECTION_ID);
    expect(seams?.children.map(c => c.id)).toEqual([seamNodeId('sA'), seamNodeId('sB')]);
    expect(seams && isCollectionVisible(seams)).toBe(false);
    const hidden = findSceneNode(tree, seamNodeId('sB'));
    expect(hidden?.label).toBe(seamLabel(project, project.pattern.seams.sB));
    expect(hidden?.note).toBe('缩缝');
    expect(hidden?.visible).toBe(false);
  });

  it('mirrors viewport visibility onto the rows', () => {
    const tree = buildSceneTree(fixture());
    expect(findSceneNode(tree, 'panel1')?.visible).toBe(true);
    expect(findSceneNode(tree, referenceNodeId('r2'))?.visible).toBe(false);
    const refs = findSceneNode(tree, REFERENCE_COLLECTION_ID);
    expect(refs && isCollectionVisible(refs)).toBe(false);
    const garments = findSceneNode(tree, GARMENT_COLLECTION_ID);
    expect(garments && isCollectionVisible(garments)).toBe(true);
  });

  it('names the avatar row after its source', () => {
    const project = fixture();
    expect(findSceneNode(buildSceneTree(project), AVATAR_NODE_ID)?.label).toBe(BUNDLED_AVATARS[0].label);
    project.avatar.source = 'procedural';
    expect(findSceneNode(buildSceneTree(project), AVATAR_NODE_ID)?.label).toBe('程序人台');
    project.avatar.source = 'glb';
    project.avatar.glbUrl = '/models/custom.glb';
    project.avatar.modelName = '模特.glb';
    expect(findSceneNode(buildSceneTree(project), AVATAR_NODE_ID)?.label).toBe('模特.glb');
  });
});

describe('transforms', () => {
  it('report the identity for objects without a stored transform', () => {
    const project = fixture();
    for (const id of [AVATAR_NODE_ID, referenceNodeId('r1'), 'panel1']) {
      expect(readTransform(project, id)).toEqual({
        position: vec3(0, 0, 0), rotationEuler: vec3(0, 0, 0), scale: vec3(1, 1, 1),
      });
    }
  });

  it('are null for rows that have no scene placement', () => {
    const project = fixture();
    expect(readTransform(project, CAMERA_NODE_ID)).toBeNull();
    expect(readTransform(project, lightNodeId('lKey'))).toBeNull();
    expect(readTransform(project, seamNodeId('sA'))).toBeNull();
    expect(readTransform(project, 'missing')).toBeNull();
  });

  it('store a detached copy per object kind', () => {
    const project = fixture();
    const position = vec3(0.2, 0.3, 0.4);
    writeTransform(project, AVATAR_NODE_ID, { position, rotationEuler: vec3(0, 0, 0), scale: vec3(1, 1, 1) });
    writeTransform(project, referenceNodeId('r1'), { position, rotationEuler: vec3(0, 0, 0), scale: vec3(2, 2, 2) });
    writeTransform(project, 'panel1', { position, rotationEuler: vec3(0, 0, 0), scale: vec3(1, 1, 1) });
    position.x = 9;
    expect(project.avatar.transform?.position.x).toBe(0.2);
    expect(project.scene.referenceObjects?.[0].transform?.position.x).toBe(0.2);
    expect(project.pattern.panels.panel1.transform?.position.x).toBe(0.2);
    expect(readTransform(project, referenceNodeId('r1'))?.scale.x).toBe(2);
  });

  it('are only offered by panel, avatar and reference rows', () => {
    for (const id of ['panel1', AVATAR_NODE_ID, referenceNodeId('r1')]) {
      const node = findSceneNode(buildSceneTree(fixture()), id);
      expect(node && supportsTransform(node.kind)).toBe(true);
    }
    expect(supportsTransform(findSceneNode(buildSceneTree(fixture()), CAMERA_NODE_ID)!.kind)).toBe(false);
  });
});

describe('panelSizeCm', () => {
  it('measures the outline bounding box', () => {
    const project = fixture();
    expect(panelSizeCm(project.pattern, 'panel1')).toEqual({ width: 30, height: 50 });
  });

  it('returns null for an unknown panel', () => {
    expect(panelSizeCm(fixture().pattern, 'nope')).toBeNull();
  });
});
