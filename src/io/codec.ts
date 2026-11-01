import type { Fabric, Notch, Pattern, Project } from '../core/model/types';

/** Encodes and decodes a Project as .ocproj.json. */
export const projectCodec = {
  encode(project: Project): string {
    return JSON.stringify(JSON.parse(JSON.stringify(project)), null, 2);
  },

  decode(json: string): Project {
    const raw = JSON.parse(json);
    if (!raw.meta || !raw.pattern || !raw.fabrics || !raw.avatar || !raw.scene) {
      throw new Error('无效的工程文件：缺少必要字段');
    }
    const project = raw as Project;
    project.pattern = normalizePattern(project.pattern);
    project.fabrics = normalizeFabrics(project.fabrics);
    return project;
  },
};

/** Fills the material appearance collections a parsed fabric may omit. */
export function normalizeFabrics(fabrics: Record<string, Fabric>): Record<string, Fabric> {
  for (const fabric of Object.values(fabrics ?? {})) {
    if (!fabric?.appearance) continue;
    fabric.appearance.maps ??= {};
    fabric.appearance.uvTiling ??= { x: 1, y: 1 };
    fabric.appearance.uvOffset ??= { x: 0, y: 0 };
    fabric.appearance.transmission ??= 0;
    fabric.appearance.thickness ??= 0.4;
    fabric.appearance.clearcoat ??= 0;
    fabric.appearance.clearcoatRoughness ??= 0.5;
    fabric.appearance.anisotropy ??= 0;
    fabric.appearance.iridescence ??= 0;
    fabric.appearance.sheenRoughness ??= 0.4;
  }
  return fabrics;
}

/** Fills collections and panel fields that a parsed or imported pattern may omit. */
export function normalizePattern(pattern: Pattern): Pattern {
  pattern.notches ??= {} as Record<string, Notch>;
  pattern.annotations ??= {};
  pattern.measurements ??= {};
  pattern.prints ??= {};
  pattern.topstitches ??= {};
  pattern.trims ??= {};
  for (const panel of Object.values(pattern.panels ?? {})) {
    panel.holes ??= [];
  }
  // Drop marks whose owner no longer exists.
  for (const [id, print] of Object.entries(pattern.prints)) {
    print.repeat ??= { x: 1, y: 1 };
    print.opacity ??= 1;
    print.angleDeg ??= 0;
    print.visible ??= true;
    if (!pattern.panels[print.panelId]) delete pattern.prints[id];
  }
  for (const [id, stitch] of Object.entries(pattern.topstitches)) {
    stitch.rows ??= 1;
    stitch.spacingMm ??= 4;
    stitch.stitchMm ??= 3;
    stitch.gapMm ??= 2;
    stitch.visible ??= true;
    if (!pattern.panels[stitch.panelId] || !pattern.edges[stitch.edgeId]) delete pattern.topstitches[id];
  }
  for (const [id, trim] of Object.entries(pattern.trims)) {
    trim.qty ??= 1;
    trim.sizeMm ??= 12;
    trim.visible ??= true;
    if (!pattern.panels[trim.panelId]) delete pattern.trims[id];
  }
  return pattern;
}

/** Downloads text content as a browser file. */
export function downloadTextFile(filename: string, content: string, mime = 'application/json'): void {
  downloadBlob(filename, new Blob([content], { type: mime }));
}

/** Downloads binary content, such as a generated PDF, as a browser file. */
export function downloadBytesFile(filename: string, content: Uint8Array, mime: string): void {
  // `slice()` copies into a fresh ArrayBuffer, which is what BlobPart accepts.
  downloadBlob(filename, new Blob([content.slice()], { type: mime }));
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads a user-selected file as text. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Reads a user-selected file as a data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
