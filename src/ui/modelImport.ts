import type { GarmentEngine } from '@/runtime';

import { genId } from '@/base/id';
import { putModelBlob } from '@/io/storage';
import { commitAvatarModel, commitEnvironmentImport, commitReferenceImport } from '@/ui/sceneCommands';
import { notify, reportActionError } from '@/ui/widgets/toast';

const MODEL_EXT = /\.(glb|gltf|obj|fbx)$/i;

const ENV_EXT = /\.(hdr|exr|png|jpg|jpeg|webp)$/i;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

export function openFilePicker(accept: string, multiple: boolean): Promise<File[] | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    let settled = false;
    const done = (files: File[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => done(input.files ? Array.from(input.files) : null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

function pickModelFiles(): Promise<File[] | null> {
  return openFilePicker('.glb,.gltf,.obj,.fbx', true);
}

async function consolidateModelFiles(files: File[]): Promise<File> {
  const gltf = files.find(f => f.name.toLowerCase().endsWith('.gltf'));
  if (gltf) return embedGltfResources(gltf, files);
  const main = files.find(f => MODEL_EXT.test(f.name));
  if (!main) throw new Error('未选择 .glb / .gltf / .obj / .fbx 模型文件');
  return main;
}

async function embedGltfResources(gltf: File, siblings: File[]): Promise<File> {
  const json = JSON.parse(await gltf.text()) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  const byName = new Map(siblings.map(f => [f.name, f]));
  const inlineUri = async (uri: string): Promise<string> => {
    const name = uri.split(/[\\/]/).pop() ?? uri;
    const file = byName.get(name);
    if (!file) throw new Error(`缺少资源文件 "${name}"，请连同 .gltf 一起选择`);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const mime = IMAGE_MIME[ext] ?? 'application/octet-stream';
    return `data:${mime};base64,${await toBase64(file)}`;
  };
  const isRelative = (uri: string) => !uri.startsWith('data:') && !/^[a-z]+:/i.test(uri);
  for (const entry of [...json.buffers ?? [], ...json.images ?? []]) {
    if (typeof entry.uri === 'string' && isRelative(entry.uri)) entry.uri = await inlineUri(entry.uri);
  }

  return new File([JSON.stringify(json)], gltf.name, { type: 'model/gltf+json' });
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}

export async function importAvatarViaPicker(): Promise<void> {
  const files = await pickModelFiles();
  if (!files) return;
  let file: File;
  try {
    file = await consolidateModelFiles(files);
  } catch (err) {
    reportActionError(err, '导入模型失败');
    return;
  }

  const key = genId('avatar');
  try {
    await putModelBlob(key, file);
  } catch (err) {
    reportActionError(err, '导入模型失败');
    return;
  }

  commitAvatarModel(key, file.name);
}

export async function importReferenceViaPicker(engine: GarmentEngine): Promise<void> {
  const files = await pickModelFiles();
  if (!files) return;
  try {
    const file = await consolidateModelFiles(files);
    const record = await engine.importReferenceObject(file, genId('ref'));
    commitReferenceImport(record);
  } catch (err) {
    reportActionError(err, '导入参考物失败');
  }
}

export async function importEnvironmentViaPicker(): Promise<void> {
  const files = await openFilePicker('.hdr,.exr,.png,.jpg,.jpeg,.webp', false);
  const file = files?.[0];
  if (!file) return;
  if (!ENV_EXT.test(file.name)) {
    notify('请选择 .hdr / .exr / .png / .jpg 环境图');
    return;
  }

  const key = genId('env');
  try {
    await putModelBlob(key, file);
  } catch (err) {
    reportActionError(err, '导入环境图失败');
    return;
  }

  commitEnvironmentImport(key, file.name);
}
