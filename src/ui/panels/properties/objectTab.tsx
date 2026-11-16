import type { PropTab } from '@/store';
import type { ObjectTransform, Project, Vec3 } from '@/model/types';
import type { SceneNode, SceneNodeKind } from '@/ui/sceneTree';
import {
  normalizeLights, parseSceneRef, readNodeName, readNodeTransform, readNodeVisible, writeNodeName,
} from '@/model';
import { SCENE_KIND_LABELS } from '@/ui/sceneTree';
import { seamNumber } from '@/pattern/seam';
import {
  commitTransform, patchValue, previewTransform, setAvatarDisplay, setNodeVisible,
  type EngineRef,
} from '@/ui/sceneCommands';
import { ButtonRow, CheckRow, Hint, Row, Section, SelectRow, SmallButton, TextRow } from '@/ui/widgets/propertyRows';
import { Vec3Field } from '@/ui/widgets/numberField';
import { degVec, radVec } from '@/ui/panels/properties/constants';
import { AvatarMaterialTab, MaterialTab, panelFabric } from '@/ui/panels/properties/materialTab';
import { LightPlacementData, ObjectData, PanelDrapeData, PanelManageRows, PanelMeshData } from '@/ui/panels/properties/objectDataSections';
import { AvatarPhysics, FabricPhysics } from '@/ui/panels/properties/physicsTabs';
import { PatternTab, ProjectTab, RenderTab } from '@/ui/panels/properties/sceneRenderTabs';

/** Property panel for the tab of one selected scene object. */
export function selectedBody(tab: PropTab, project: Project, nodeId: string, node: SceneNode, engineRef: EngineRef) {
  switch (tab) {
    case 'object':
      return <ObjectTab project={project} nodeId={nodeId} kind={node.kind} label={node.label} note={node.note} engineRef={engineRef} />;
    case 'material':
      return node.kind === 'avatar'
        ? <AvatarMaterialTab project={project} />
        : <MaterialTab project={project} panelId={nodeId} engineRef={engineRef} />;
    case 'simulator': {
      if (node.kind === 'avatar') return <AvatarPhysics project={project} />;
      const fabric = panelFabric(project, nodeId);
      return (
        <>
          {fabric ? <FabricPhysics fabric={fabric} /> : <Hint>此对象没有关联面料。</Hint>}
          <PanelMeshData project={project} panelId={nodeId} />
        </>
      );
    }
    case 'transform':
      return <TransformTab project={project} nodeId={nodeId} kind={node.kind} engineRef={engineRef} />;
    case 'render':
      return <RenderTab project={project} />;
    case 'pattern':
      return <PatternTab project={project} engineRef={engineRef} />;
    default:
      return <ProjectTab project={project} engineRef={engineRef} />;
  }
}

/** Identity of one selected object and the rows its kind carries; transform and drape sit in the 变换 tab. */
function ObjectTab({ project, nodeId, kind, label, note, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; label: string; note?: string; engineRef: EngineRef;
}) {
  const nodeRef = parseSceneRef(nodeId);
  const panel = nodeRef.kind === 'panel' ? project.pattern.panels[nodeRef.id] ?? null : null;
  const isAvatar = nodeRef.kind === 'avatar';
  const isEnvironment = nodeRef.kind === 'environment';
  const light = nodeRef.kind === 'light'
    ? normalizeLights(project.scene.lights).find(l => l.id === nodeRef.id) ?? null
    : null;
  const seam = nodeRef.kind === 'seam' ? project.pattern.seams[nodeRef.id] ?? null : null;
  /** Number the canvas paints on both sides of this seam. */
  const seamNo = seam ? seamNumber(project.pattern, seam.id) : null;
  /** Viewport visibility or enable flag of the node; null when the kind has none. */
  const shown = readNodeVisible(project, nodeId);
  const setShown = (value: boolean) => setNodeVisible(nodeId, value, engineRef);

  /** Command label of a rename, following the object kind. */
  const renameLabel = kind === 'panel' ? '重命名版片'
    : kind === 'reference' ? '重命名参考物'
    : kind === 'avatar' ? '重命名模特'
    : `重命名${SCENE_KIND_LABELS[kind]}`;

  /** Stores a custom node name; clearing it brings back the kind label. */
  const rename = (next: string) => {
    patchValue(renameLabel,
      p => readNodeName(p, nodeId) ?? '',
      (ctx, v) => { writeNodeName(ctx.project, nodeId, v); }, next);
  };
  const storedName = readNodeName(project, nodeId);
  // The outliner labels a seam with its number; the name row keeps the plain name.
  const nameText = storedName ?? (seam ? SCENE_KIND_LABELS.seam : label);

  return (
    <>
      <Section title="对象">
        <TextRow label="名称" value={nameText} onChange={rename} />
        {seamNo !== null && <Row label="编号">{seamNo}</Row>}
        {shown !== null && (
          <CheckRow label={light || isEnvironment ? '启用' : '可见性'} checked={shown} onChange={setShown} />
        )}
        {isAvatar && (
          <SelectRow label="外观" value={project.avatar.display === 'translucent' ? 'translucent' : 'solid'}
            options={[{ value: 'solid', label: '实体' }, { value: 'translucent', label: '半透明' }]}
            onChange={v => setAvatarDisplay(v === 'translucent' ? 'translucent' : 'visible', engineRef)} />
        )}
        {panel && <PanelManageRows panel={panel} />}
        <Row label="类型">{note ? `${SCENE_KIND_LABELS[kind]} · ${note}` : SCENE_KIND_LABELS[kind]}</Row>
      </Section>
      <ObjectData project={project} nodeId={nodeId} kind={kind} engineRef={engineRef} />
    </>
  );
}

/** Object transform, a light's position and aim, and the drape placement a panel wraps with. */
function TransformTab({ project, nodeId, kind, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; engineRef: EngineRef;
}) {
  const nodeRef = parseSceneRef(nodeId);
  // A light is placed by `LightPlacementData`, which keeps its aim; rotation and scale mean nothing to it.
  const transform = nodeRef.kind === 'light' ? null : readNodeTransform(project, nodeId);
  /** Avatar and reference edits move the live object before they are committed. */
  const live = nodeRef.kind === 'avatar' || nodeRef.kind === 'reference';

  /** Edits one transform part. */
  const setPart = (part: 'position' | 'rotationEuler' | 'scale', value: Vec3) => {
    if (!transform) return;
    const next: ObjectTransform = { ...transform, [part]: value };
    if (live) previewTransform(nodeId, next, engineRef);
    commitTransform(nodeId, next, engineRef);
  };

  return (
    <>
      {transform && (
        <Section title="变换">
          <Vec3Field label="位置" value={transform.position} step={0.01} precision={2} unit="m"
            onPreview={live ? v => previewTransform(nodeId, { ...transform, position: v }, engineRef) : undefined}
            onCommit={v => setPart('position', v)} />
          <Vec3Field label="旋转" value={degVec(transform.rotationEuler)} step={0.5} precision={1} unit="°"
            onPreview={live ? v => previewTransform(nodeId, { ...transform, rotationEuler: radVec(v) }, engineRef) : undefined}
            onCommit={v => setPart('rotationEuler', radVec(v))} />
          <Vec3Field label="缩放" value={transform.scale} step={0.01} precision={3} min={0.01} max={20}
            onPreview={live ? v => previewTransform(nodeId, { ...transform, scale: v }, engineRef) : undefined}
            onCommit={v => setPart('scale', v)} />
          <ButtonRow>
            <SmallButton onClick={() => commitTransform(nodeId, {
              position: { x: 0, y: 0, z: 0 }, rotationEuler: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
            }, engineRef, '复位变换')}>复位变换</SmallButton>
          </ButtonRow>
        </Section>
      )}
      {kind === 'light' && <LightPlacementData project={project} nodeId={nodeId} />}
      {kind === 'panel' && nodeRef.kind === 'panel' && <PanelDrapeData project={project} panelId={nodeRef.id} />}
      {!transform && kind !== 'panel' && kind !== 'light' && <Hint>这个对象没有变换。</Hint>}
    </>
  );
}
