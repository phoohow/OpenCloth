import { useUIStore, type PropTab } from '../../../store/stores';
import type { ObjectTransform, Project, Vec3 } from '../../../core/model/types';
import type { SceneNode, SceneNodeKind } from '../../sceneTree';
import {
  AVATAR_NODE_ID, SCENE_KIND_LABELS, avatarLabel, readTransform, referenceObjectId,
} from '../../sceneTree';
import {
  commitTransform, patchValue, previewTransform, setAvatarDisplay,
  setPanelsVisible, setReferencesVisible, type EngineRef,
} from '../../sceneCommands';
import { ButtonRow, CheckRow, Hint, Row, Section, SmallButton, TextRow } from '../../widgets/propertyRows';
import { Vec3Field } from '../../widgets/numberField';
import { degVec, radVec } from './constants';
import { styles } from './styles';
import { MaterialTab, panelFabric } from './materialTab';
import { ObjectData } from './objectDataSections';
import { AvatarPhysics, FabricPhysics } from './physicsTabs';
import { RenderTab, SceneTab } from './sceneRenderTabs';

/** Property panel for the tab of one selected scene object. */
export function selectedBody(tab: PropTab, project: Project, nodeId: string, node: SceneNode, engineRef: EngineRef) {
  switch (tab) {
    case 'object':
      return <ObjectTab project={project} nodeId={nodeId} kind={node.kind} label={node.label} note={node.note} engineRef={engineRef} />;
    case 'material':
      return <MaterialTab project={project} panelId={nodeId} engineRef={engineRef} />;
    case 'physics': {
      if (node.kind === 'avatar') return <AvatarPhysics project={project} />;
      const fabric = panelFabric(project, nodeId);
      return fabric ? <FabricPhysics fabric={fabric} /> : <Hint>此对象没有关联面料。</Hint>;
    }
    case 'render':
      return <RenderTab project={project} />;
    default:
      return <SceneTab project={project} />;
  }
}

/** One selected object: identity, transform, then the rows its kind carries. */
function ObjectTab({ project, nodeId, kind, label, note, engineRef }: {
  project: Project; nodeId: string; kind: SceneNodeKind; label: string; note?: string; engineRef: EngineRef;
}) {
  const transform = readTransform(project, nodeId);
  const panel = project.pattern.panels[nodeId];
  const ref = nodeId.startsWith('@ref:')
    ? (project.scene.referenceObjects ?? []).find(r => r.id === referenceObjectId(nodeId))
    : null;
  const isAvatar = nodeId === AVATAR_NODE_ID;
  /** Avatar and reference edits move the live object before they are committed. */
  const live = isAvatar || !!ref;

  /** Edits one transform part. */
  const setPart = (part: 'position' | 'rotationEuler' | 'scale', value: Vec3) => {
    if (!transform) return;
    const next: ObjectTransform = { ...transform, [part]: value };
    if (live) previewTransform(nodeId, next, engineRef);
    commitTransform(nodeId, next, engineRef);
  };

  /** Viewport visibility, the same checkbox for every kind that stores it. */
  const shown = isAvatar ? project.avatar.display !== 'hidden' : (panel?.visible ?? ref?.visible ?? true);
  const setShown = (value: boolean) => {
    if (panel) setPanelsVisible([panel.id], value);
    else if (ref) setReferencesVisible([ref.id], value, engineRef);
    else if (isAvatar) {
      const display = project.avatar.display;
      if (!value) setAvatarDisplay('hidden', engineRef);
      else setAvatarDisplay(display === 'translucent' ? 'translucent' : 'visible', engineRef);
    }
  };

  /** Names live on the object record, so the row edits it only where one exists. */
  const storedName = panel?.name ?? ref?.name ?? (isAvatar ? avatarLabel(project) : null);

  /** Renames the object record, leaving the pattern and avatar identity intact. */
  const rename = (next: string) => {
    if (panel) {
      patchValue('重命名版型片', p => p.pattern.panels[panel.id]?.name ?? '',
        (ctx, v) => { const target = ctx.project.pattern.panels[panel.id]; if (target) target.name = v; }, next);
    } else if (ref) {
      patchValue('重命名参考物体', p => (p.scene.referenceObjects ?? []).find(r => r.id === ref.id)?.name ?? '',
        (ctx, v) => {
          const target = (ctx.project.scene.referenceObjects ?? []).find(r => r.id === ref.id);
          if (target) target.name = v;
          ctx.project.scene = { ...ctx.project.scene };
          useUIStore.getState().bumpRefObjects();
        }, next);
    } else if (isAvatar) {
      patchValue('重命名模特', p => p.avatar.modelName ?? '',
        (ctx, v) => { ctx.project.avatar.modelName = v; }, next);
    }
  };

  return (
    <>
      <Section title="对象">
        {storedName === null
          ? <Row label="名称">{label}</Row>
          : <TextRow label="名称" value={storedName} onChange={rename} />}
        {(panel || ref || isAvatar) && (
          <CheckRow label="可见性" checked={shown} onChange={setShown} />
        )}
        <Row label="类型">{note ? `${SCENE_KIND_LABELS[kind]} · ${note}` : SCENE_KIND_LABELS[kind]}</Row>
      </Section>
      {transform && (
        <Section title="变换">
          <Vec3Field label="位置" value={transform.position} step={0.01} precision={2} suffix="m"
            onPreview={live ? v => previewTransform(nodeId, { ...transform, position: v }, engineRef) : undefined}
            onCommit={v => setPart('position', v)} />
          <Vec3Field label="旋转" value={degVec(transform.rotationEuler)} step={0.5} precision={1} suffix="°"
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
          {!live && <div style={styles.note}>版型片变换在松手后重建布料并重置模拟。</div>}
        </Section>
      )}
      <ObjectData project={project} nodeId={nodeId} kind={kind} engineRef={engineRef} />
    </>
  );
}
