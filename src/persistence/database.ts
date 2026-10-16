import type { WorkspaceState } from '../types'

const DATABASE_NAME = 'jlpt-listening-studio'
const DATABASE_VERSION = 1
const WORKSPACE_STORE = 'workspace'
const AUDIO_STORE = 'audio-blobs'
const WORKSPACE_KEY = 'current'

let databasePromise: Promise<IDBDatabase> | null = null

const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'))
  })

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB 事务失败'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB 事务已取消'))
  })

const openDatabase = () => {
  if (databasePromise) return databasePromise
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE)
      }
      if (!database.objectStoreNames.contains(AUDIO_STORE)) {
        database.createObjectStore(AUDIO_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'))
    request.onblocked = () => reject(new Error('本地数据库升级被其他页面阻止，请关闭旧页面后重试。'))
  })
  return databasePromise
}

export const loadWorkspace = async (): Promise<unknown> => {
  const database = await openDatabase()
  const transaction = database.transaction(WORKSPACE_STORE, 'readonly')
  return requestResult<unknown>(
    transaction.objectStore(WORKSPACE_STORE).get(WORKSPACE_KEY),
  )
}

export const saveWorkspace = async (workspace: WorkspaceState): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(WORKSPACE_STORE, 'readwrite')
  transaction.objectStore(WORKSPACE_STORE).put(workspace, WORKSPACE_KEY)
  await transactionDone(transaction)
}

export const saveAudioBlob = async (assetId: string, blob: Blob): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(AUDIO_STORE, 'readwrite')
  transaction.objectStore(AUDIO_STORE).put(blob, assetId)
  await transactionDone(transaction)
}

export const replaceAudioBlobs = async (audio: Map<string, Blob>): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(AUDIO_STORE, 'readwrite')
  const store = transaction.objectStore(AUDIO_STORE)
  store.clear()
  audio.forEach((blob, assetId) => store.put(blob, assetId))
  await transactionDone(transaction)
}

export const loadAudioBlob = async (assetId: string): Promise<Blob | undefined> => {
  const database = await openDatabase()
  const transaction = database.transaction(AUDIO_STORE, 'readonly')
  return requestResult<Blob | undefined>(
    transaction.objectStore(AUDIO_STORE).get(assetId),
  )
}

export const removeAudioBlob = async (assetId: string): Promise<void> => {
  const database = await openDatabase()
  const transaction = database.transaction(AUDIO_STORE, 'readwrite')
  transaction.objectStore(AUDIO_STORE).delete(assetId)
  await transactionDone(transaction)
}

export const describeStorage = async () => {
  if (!navigator.storage?.estimate) return undefined
  const estimate = await navigator.storage.estimate()
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  }
}

export const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
