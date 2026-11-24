import { downloadBlob } from '@/base/platform/download';

export interface SaveFileType {
  description: string;
  accept: Record<string, string[]>;
}

export interface SaveFile {
  readonly name: string;
  write(data: Blob): Promise<void>;
}

interface SaveFileWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  readonly name: string;
  createWritable(): Promise<SaveFileWritable>;
}

interface SaveDialogOptions {
  suggestedName?: string;
  types?: SaveFileType[];
}

type ShowSaveFilePicker = (options?: SaveDialogOptions) => Promise<SaveFileHandle>;

function saveDialog(): ShowSaveFilePicker | null {
  const picker = (globalThis as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  return typeof picker === 'function' ? picker : null;
}

export function canChooseSaveFile(): boolean {
  return saveDialog() !== null;
}

export async function chooseSaveFile(
  suggestedName: string, types?: SaveFileType[],
): Promise<SaveFile | null> {
  const picker = saveDialog();
  if (!picker) {
    return {
      name: suggestedName,
      write: async data => downloadBlob(data, suggestedName),
    };
  }

  let handle: SaveFileHandle;
  try {
    handle = await picker(types ? { suggestedName, types } : { suggestedName });
  } catch (error) {
    if ((error as DOMException | undefined)?.name === 'AbortError') return null;
    throw error;
  }

  return {
    name: handle.name,
    async write(data) {
      const writable = await handle.createWritable();
      try {
        await writable.write(data);
      } catch (error) {
        await writable.close().catch(() => undefined);
        throw error;
      }

      await writable.close();
    },
  };
}
