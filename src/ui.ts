export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function append(parent: Node, ...kids: Array<Node | string | null | undefined | false>): void {
  for (const kid of kids) {
    if (kid == null || kid === false || kid === '') continue;
    parent.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
}

export function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const wrap = el('label', 'field');
  wrap.append(el('span', 'field-label', label));
  wrap.append(control);
  if (hint) wrap.append(el('span', 'hint', hint));
  return wrap;
}

export function showToast(message: string, undo?: () => void): void {
  const node = document.getElementById('toast');
  if (!node) return;
  node.replaceChildren(document.createTextNode(message));
  if (undo) {
    const action = button('Undo', 'toast-undo', () => {
      window.clearTimeout(toastTimer);
      node.hidden = true;
      undo();
    });
    node.append(action);
  }
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
  }, 4800);
}

let toastTimer = 0;

export function download(filename: string, contents: string, type: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function uid(): string {
  return crypto.randomUUID();
}

export function go(hash: string): void {
  const next = hash.startsWith('#') ? hash : `#${hash}`;
  if (location.hash !== next) location.hash = next;
}
