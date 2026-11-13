// hash 路由
export type Route = 'projects' | 'boreholes' | 'params' | 'view3d' | 'section';

const VALID: Route[] = ['projects', 'boreholes', 'params', 'view3d', 'section'];

export function currentRoute(): Route {
  const r = location.hash.replace('#/', '') as Route;
  return VALID.includes(r) ? r : 'projects';
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}

export function onRouteChange(cb: (r: Route) => void): () => void {
  const handler = (): void => cb(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
