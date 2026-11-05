import type { PropTab } from '@/store';
import type { ObjectTransform, Project, Vec3 } from '@/model/types';
import type { SceneNode, SceneNodeKind } from '@/ui/sceneTree';
import { storedSceneName, writeSceneName } from '@/commands';
import { AVATAR_NODE_ID, ENVIRONMENT_NODE_ID, lightObjectId, readTransform, referenceObjectId } from '@/model';
import { SCENE_KIND_LABELS } from '@/ui/sceneTree';
import { parseElementNodeId } from '@/model';
import { normalizeLights } from '@/model';
import { seamNumber } from '@/pattern/seam';
import {
  commitTransform, patchValue, previewTransform, setAvatarDisplay, setEnvironmentEnabled,
  setLightsEnabled, setPanelsVisible, setProductionVisible, setReferencesVisible, setSeamsStitchVisible,
  type EngineRef,
} from '@/ui/sceneCommands';
import { ButtonRow, CheckRow, Hint, Row, Section, SelectRow, SmallButton, TextRow } from '@/ui/widgets/propertyRows';
import { Vec3Field } from '@/ui/widgets/numberField';
import { degVec, radVec } from '@/ui/panels/properties/constants';
import { styles } from '@/ui/panels/properties/styles';
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
  const panel = project.pattern.panels[nodeId];
  const ref = nodeId.startsWith('@ref:')
    ? (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId))
    : null;
  const isAvatar = nodeId === AVATAR_NODE_ID;
  const isEnvironment = nodeId === ENVIRONMENT_NODE_ID;
  const light = nodeId.startsWith('@light:')
    ? normalizeLights(project.scene.lights).find(l => l.id === lightObjectId(nodeId)) ?? null
    : null;
  const elementId = parseElementNodeId(nodeId);
  const seam = elementId?.kind === 'seam' ? project.pattern.seams[elementId.id] ?? null : null;
  /** Number the canvas paints on both sides of this seam. */
  const seamNo = seam ? seamNumber(project.pattern, seam.id) : null;
  const production = elementId?.kind === 'print' ? project.pattern.prints?.[elementId.id] ?? null
    : elementId?.kind === 'topstitch' ? project.pattern.topstitches?.[elementId.id] ?? null
    : elementId?.kind === 'trim' ? project.pattern.trims?.[elementId.id] ?? null
    : null;
  /** Viewport visibility or enable flag of the row; null when the kind has none. */
  const shown = isAvatar ? project.avatar.display !== 'hidden'
    : panel ? panel.visible
    : ref ? ref.visible
    : seam ? seam.stitchVisible
    : production ? production.visible !== false
    : light ? light.enabled
    : isEnvironment ? project.scene.lights.iblEnabled
    : null;
  const setShown = (value: boolean) => {
    if (panel) setPanelsVisible([panel.id], value);
    else if (ref) setReferencesVisible([ref.id], value, engineRef);
    else if (seam) setSeamsStitchVisible([seam.id], value);
    else if (production && elementId) {
      const kind = elementId.kind;
      if (kind === 'print' || kind === 'topstitch' || kind === 'trim') setProductionVisible(kind, [production.id], value);
    } else if (light) setLightsEnabled([light.id], value);
    else if (isEnvironment) setEnvironmentEnabled(value);
    else if (isAvatar) {
      const display = project.avatar.display;
      if (!value) setAvatarDisplay('hidden', engineRef);
      else setAvatarDisplay(display === 'translucent' ? 'translucent' : 'visible', engineRef);
    }
  };

  /** Command label of a rename, following the object kind. */
  const renameLabel = kind === 'panel' ? '重命名版片'
    : kind === 'reference' ? '重命名参考物体'
    : kind === 'avatar' ? '重命名模特'
    : `重命名${SCENE_KIND_LABELS[kind]}`;

  /** Stores a custom row name; clearing it brings back the kind label. */
  const rename = (next: string) => {
    patchValue(renameLabel,
      p => storedSceneName(p, nodeId) ?? '',
      (ctx, v) => writeSceneName(ctx.project, nodeId, v), next);
  };
  const storedName = storedSceneName(project, nodeId);
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
  const transform = readTransform(project, nodeId);
  /** Avatar and reference edits move the live object before they are committed. */
  const live = nodeId === AVATAR_NODE_ID || nodeId.startsWith('@ref:');

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
          {!live && <div style={styles.note}>版片变换在松手后重建布料并重置模拟。</div>}
        </Section>
      )}
      {kind === 'light' && <LightPlacementData project={project} nodeId={nodeId} />}
      {kind === 'panel' && <PanelDrapeData project={project} panelId={nodeId} />}
      {!transform && kind !== 'panel' && kind !== 'light' && <Hint>这个对象没有变换。</Hint>}
    </>
  );
}
