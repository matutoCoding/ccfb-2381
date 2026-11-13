// IndexedDB 持久化：项目（含钻孔、岩性、参数、模型）存浏览器本地
import type { Project } from '../types';

const DB_NAME = 'strat3d';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => {
          t.oncomplete = () => {
            db.close();
            resolve(req.result);
          };
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      }),
  );
}

export const projectDb = {
  async list(): Promise<Project[]> {
    const all = await tx('readonly', (s) => s.getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async get(id: string): Promise<Project | undefined> {
    return tx('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
  },
  async put(project: Project): Promise<void> {
    await tx('readwrite', (s) => s.put(project));
  },
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },
  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.clear());
  },
};

/** 导出项目为 JSON 文件（TypedArray 转普通数组，便于跨机器打开） */
export function projectToJson(project: Project): string {
  const clone = structuredClone(project);
  if (clone.model) {
    const m = clone.model;
    m.voxels = Array.from(m.voxels) as unknown as Uint8Array;
    m.surfaces.ground = Array.from(m.surfaces.ground) as unknown as Float64Array;
    m.surfaces.top = m.surfaces.top.map((g) => Array.from(g) as unknown as Float64Array);
    m.surfaces.bottom = m.surfaces.bottom.map((g) => Array.from(g) as unknown as Float64Array);
  }
  return JSON.stringify({ format: 'strat3d-project', version: 1, ...clone }, null, 2);
}

/** 解析导入的项目 JSON，恢复 TypedArray */
export function projectFromJson(text: string): Project {
  const data = JSON.parse(text);
  if (data.format !== 'strat3d-project') throw new Error('文件格式不是 strat3d 项目导出');
  const project: Project = data;
  if (project.model) {
    const m = project.model;
    m.voxels = Uint8Array.from(m.voxels as unknown as number[]);
    m.surfaces.ground = Float64Array.from(m.surfaces.ground as unknown as number[]);
    m.surfaces.top = m.surfaces.top.map((g) => Float64Array.from(g as unknown as number[]));
    m.surfaces.bottom = m.surfaces.bottom.map((g) => Float64Array.from(g as unknown as number[]));
  }
  project.id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  project.name = `${project.name}（导入副本）`;
  return project;
}
