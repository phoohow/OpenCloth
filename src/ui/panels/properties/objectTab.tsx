import type { Project, Vec3 } from '@/model/types';
import type { PropTab } from '@/store';
import type { SceneNode, SceneNodeKind } from '@/ui/sceneTree';

import {
  normalizeLights, parseSceneRef, readNodeName, readNodeTransform, readNodeVisible, writeNodeName,
} from '@/model';
import { seamNumber } from '@/pattern/seam';
import { degVec, radVec } from '@/ui/panels/properties/constants';
import { AvatarMaterialTab, MaterialTab, panelFabric } from '@/ui/panels/properties/materialTab';
import { LightPlacementData, ObjectData, PanelCollisionData, PanelDrapeData, PanelManageRows } from '@/ui/panels/properties/objectDataSections';
import { AvatarPhysics, FabricPhysics, FloorPhysics } from '@/ui/panels/properties/physicsTabs';
import { PrintMaterialTab, TopstitchMaterialTab, TrimMaterialTab } from '@/ui/panels/properties/productionSections';
import { PatternTab, ProjectTab, RenderTab } from '@/ui/panels/properties/sceneRenderTabs';
import { SeamMaterialTab } from '@/ui/panels/properties/seamSections';
import {
  commitTransform, patchValue, setNodeVisible,
  type EngineRef,
} from '@/ui/sceneCommands';
import { SCENE_KIND_LABELS } from '@/ui/sceneTree';
import { Vec3Field } from '@/ui/widgets/numberField';
import { ButtonRow, CheckRow, Hint, Row, Section, SmallButton, TextRow } from '@/ui/widgets/propertyRows';

export function selectedBody(tab: PropTab, project: Project, nodeId: string, node: SceneNode, engineRef: EngineRef) {
  switch (tab) {
    case 'object':
      return <ObjectTab project={project} nodeId={nodeId} kind={node.kind} label={node.label} note={node.note} engineRef={engineRef} />;
    case 'material':
      switch (node.kind) {
        case 'avatar': return <AvatarMaterialTab project={project} engineRef={engineRef} />;
        case 'seam': return <SeamMaterialTab project={project} nodeId={nodeId} />;
        case 'print': return <PrintMaterialTab project={project} nodeId={nodeId} />;
        case 'topstitch': return <TopstitchMaterialTab project={project} nodeId={nodeId} />;
        case 'trim': return <TrimMaterialTab project={project} nodeId={nodeId} />;
        default: return <MaterialTab project={project} panelId={nodeId} engineRef={engineRef} />;
      }
    case 'simulator': {
      if (node.kind === 'avatar') return <AvatarPhysics project={project} />;
      if (node.kind === 'floor') return <FloorPhysics project={project} />;
      const fabric = panelFabric(project, nodeId);
      return (
        <>
          {fabric ? <FabricPhysics fabric={fabric} /> : <Hint>此对象没有关联面料。</Hint>}
          <PanelCollisionData project={project} panelId={nodeId} />
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
      return <ProjectTab project={project} />;
  }
}

function ObjectTab({ project, nodeId, kind, label, note, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; label: string; note?: string; engineRef: EngineRef;
}) {
  const nodeRef = parseSceneRef(nodeId);
  const panel = nodeRef.kind === 'panel' ? project.pattern.panels[nodeRef.id] ?? null : null;
  const isEnvironment = nodeRef.kind === 'environment';
  const light = nodeRef.kind === 'light'
    ? normalizeLights(project.scene.lights).find(l => l.id === nodeRef.id) ?? null
    : null;
  const seam = nodeRef.kind === 'seam' ? project.pattern.seams[nodeRef.id] ?? null : null;
  const seamNo = seam ? seamNumber(project.pattern, seam.id) : null;
  const shown = readNodeVisible(project, nodeId);
  const setShown = (value: boolean) => setNodeVisible(nodeId, value, engineRef);

  const renameLabel = kind === 'panel' ? '重命名版片'
    : kind === 'reference' ? '重命名参考物'
    : kind === 'avatar' ? '重命名模特'
    : `重命名${SCENE_KIND_LABELS[kind]}`;

  const rename = (next: string) => {
    patchValue(renameLabel,
      p => readNodeName(p, nodeId) ?? '',
      (ctx, v) => { writeNodeName(ctx.project, nodeId, v); }, next);
  };
  const storedName = readNodeName(project, nodeId);
  const nameText = storedName ?? (seam ? SCENE_KIND_LABELS.seam : label);

  return (
    <>
      <Section title="对象">
        <TextRow label="名称" value={nameText} onChange={rename} />
        {seamNo !== null && <Row label="编号">{seamNo}</Row>}
        {shown !== null && (
          <CheckRow label={light || isEnvironment ? '启用' : '可见性'} checked={shown} onChange={setShown} />
        )}
        {panel && <PanelManageRows panel={panel} />}
        <Row label="类型">{note ? `${SCENE_KIND_LABELS[kind]} · ${note}` : SCENE_KIND_LABELS[kind]}</Row>
      </Section>
      <ObjectData project={project} nodeId={nodeId} kind={kind} engineRef={engineRef} />
    </>
  );
}

function TransformTab({ project, nodeId, kind, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; engineRef: EngineRef;
}) {
  const nodeRef = parseSceneRef(nodeId);
  const transform = nodeRef.kind === 'light' ? null : readNodeTransform(project, nodeId);

  const setPart = (part: 'position' | 'rotationEuler' | 'scale', value: Vec3) => {
    if (!transform) return;
    commitTransform(nodeId, { ...transform, [part]: value }, engineRef);
  };

  return (
    <>
      {transform && (
        <Section title="变换">
          <Vec3Field label="位置" tip="m" value={transform.position} step={0.01} precision={2}
            onCommit={v => setPart('position', v)} />
          <Vec3Field label="旋转" tip="°" value={degVec(transform.rotationEuler)} step={0.5} precision={1}
            onCommit={v => setPart('rotationEuler', radVec(v))} />
          <Vec3Field label="缩放" tip="对象的缩放暂不可调" value={transform.scale} step={0.01} precision={3}
            min={0.01} max={20} disabled onCommit={v => setPart('scale', v)} />
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
