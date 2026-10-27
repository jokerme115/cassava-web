export type CorrectionDraft = {
  id: string;
  baseVersion: number;
  width: number;
  height: number;
  cassava: Uint8Array;
  rotten: Uint8Array;
  note: string;
  savedAt: string;
};

const openDrafts = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open('cassava-correction-drafts', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const database = await openDrafts();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('drafts', mode);
    const request = action(tx.objectStore('drafts'));
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onerror = () => { database.close(); reject(tx.error); };
    tx.onabort = () => { database.close(); reject(tx.error); };
  });
};

export const readDraft = (id: string) => transaction<CorrectionDraft | undefined>('readonly', (store) => store.get(id));
export const writeDraft = (draft: CorrectionDraft) => transaction('readwrite', (store) => store.put(draft));
export const removeDraft = (id: string) => transaction('readwrite', (store) => store.delete(id));
