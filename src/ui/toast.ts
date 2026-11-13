import { h } from './dom';

type ToastKind = 'info' | 'ok' | 'err' | 'warn';

function host(): HTMLElement {
  let el = document.querySelector<HTMLElement>('.toast-host');
  if (!el) {
    el = h('div.toast-host');
    document.body.append(el);
  }
  return el;
}

export function toast(message: string, kind: ToastKind = 'info', durationMs = 3800): void {
  const el = h(`div.toast${kind === 'info' ? '' : ' ' + kind}`, {}, message);
  host().append(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 320);
  }, durationMs);
}
