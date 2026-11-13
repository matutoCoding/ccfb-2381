// 全局应用状态（极简发布订阅 store）+ 项目持久化
import { DEFAULT_PARAMS, type Project } from '../types';
import { projectDb } from '../lib/db';
import { validateBoreholes } from '../lib/validation';

export interface AppState {
  projects: Project[];
  currentId: string | null;
  gpuAvailable: boolean | null; // null = 尚未探测
}

type Listener = (state: AppState) => void;

const state: AppState = { projects: [], currentId: null, gpuAvailable: null };
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l({ ...state, projects: [...state.projects] });
}

export const appStore = {
  getState(): AppState {
    return state;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setGpuAvailable(v: boolean): void {
    state.gpuAvailable = v;
    emit();
  },
  current(): Project | null {
    return state.projects.find((p) => p.id === state.currentId) ?? null;
  },
  async hydrate(): Promise<void> {
    state.projects = await projectDb.list();
    if (!state.currentId && state.projects.length > 0) state.currentId = state.projects[0].id;
    emit();
  },
  async createProject(name: string): Promise<Project> {
    const now = Date.now();
    const project: Project = {
      id: `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
      bounds: null,
      boreholes: [],
      lithologies: [],
      fault: null,
      params: { ...DEFAULT_PARAMS },
      validation: null,
      model: null,
    };
    state.projects.unshift(project);
    state.currentId = project.id;
    await projectDb.put(project);
    emit();
    return project;
  },
  async deleteProject(id: string): Promise<void> {
    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.currentId === id) state.currentId = state.projects[0]?.id ?? null;
    await projectDb.remove(id);
    emit();
  },
  select(id: string): void {
    state.currentId = id;
    emit();
  },
  /** 修改当前项目并落库 */
  async mutate(mut: (p: Project) => void): Promise<Project | null> {
    const p = this.current();
    if (!p) return null;
    mut(p);
    p.updatedAt = Date.now();
    await projectDb.put(p);
    emit();
    return p;
  },
  async replace(project: Project): Promise<void> {
    const idx = state.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) state.projects[idx] = project;
    else state.projects.unshift(project);
    state.currentId = project.id;
    await projectDb.put(project);
    emit();
  },
  revalidate(p: Project): void {
    const known = new Set(p.lithologies.map((l) => l.id));
    p.validation = validateBoreholes(p.boreholes, known);
  },
};
