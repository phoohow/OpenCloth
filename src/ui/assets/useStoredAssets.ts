import { ASSET_MESSAGES } from '@/ui/assets/messages';
import { notify } from '@/ui/widgets/toast';
import { useCallback, useEffect, useState } from 'react';

export interface StoredAssetIo<T> {
  list: () => Promise<T[]>;
  remove: (id: string) => Promise<void>;
}

export interface StoredAssets<T> {
  items: T[];
  refresh: () => Promise<void>;
  remove: (id: string, name: string) => Promise<void>;
}

export function useStoredAssets<T>(io: StoredAssetIo<T>): StoredAssets<T> {
  const [items, setItems] = useState<T[]>([]);
  const { list, remove: removeRecord } = io;

  const refresh = useCallback(async () => {
    try {
      setItems(await list());
    } catch {
      notify(ASSET_MESSAGES.listFailed);
    }
  }, [list]);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = useCallback(async (id: string, name: string) => {
    try {
      await removeRecord(id);
      await refresh();
      notify(`已移除「${name}」`);
    } catch {
      notify(ASSET_MESSAGES.removeFailed(name));
    }
  }, [removeRecord, refresh]);

  return { items, refresh, remove };
}
