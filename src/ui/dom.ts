// 极简 DOM 构造器：h('div.class#id', { onClick }, children...)
export type Child = Node | string | number | false | null | undefined;

export function h(tag: string, props: Record<string, unknown> = {}, ...children: (Child | Child[])[]): HTMLElement {
  let el: HTMLElement;
  let selector = tag;
  if (tag === 'svg' || tag.startsWith('svg:')) {
    const name = tag.replace('svg:', '');
    el = document.createElementNS('http://www.w3.org/2000/svg', name) as unknown as HTMLElement;
  } else {
    // 允许 "div.a.b#c" 形式；带空格的类名拆分为多个 class
    const m = /^([a-zA-Z0-9]+)((?:[.#][\w-]+)*)$/.exec(tag);
    if (m) {
      el = document.createElement(m[1]);
      selector = m[2];
    } else if (/^[a-zA-Z0-9]+[.#]/.test(tag)) {
      const firstDot = tag.search(/[.#]/);
      el = document.createElement(tag.slice(0, firstDot));
      selector = tag.slice(firstDot);
    } else {
      el = document.createElement(tag);
      selector = '';
    }
  }
  if (selector) {
    for (const part of selector.split(/(?=[.#])/).filter(Boolean)) {
      if (part[0] === '.') el.classList.add(...part.slice(1).split(/\s+/).filter(Boolean));
      else el.id = part.slice(1);
    }
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' && typeof v === 'string') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v as object);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v as object);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v === true ? '' : v));
  }
  for (const c of children.flat()) {
    if (c === false || c === null || c === undefined) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function mount(el: HTMLElement, parent: HTMLElement): void {
  parent.replaceChildren(el);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}

export function rgbCss(c: [number, number, number], alpha = 1): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
