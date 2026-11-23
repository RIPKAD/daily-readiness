const NS = 'http://www.w3.org/2000/svg';

export function lineChart(
  points: { label: string; value: number }[],
  options: { min?: number; max?: number; zones?: boolean } = {},
): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 168');
  svg.setAttribute('role', 'img');
  svg.classList.add('chart');
  const width = 320;
  const height = 168;
  const padX = 8;
  const padY = 12;
  const min = options.min ?? Math.min(...points.map((point) => point.value));
  const max = options.max ?? Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const xAt = (index: number) => padX + (points.length === 1 ? (width - padX * 2) / 2 : (index / (points.length - 1)) * (width - padX * 2));
  const yAt = (value: number) => padY + (1 - (value - min) / span) * (height - padY * 2);

  if (options.zones) {
    band(svg, yAt(100), yAt(65), '#1a2e24');
    band(svg, yAt(65), yAt(40), '#2a2418');
    band(svg, yAt(40), yAt(0), '#2c1c1a');
  }

  const path = document.createElementNS(NS, 'path');
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index).toFixed(1)} ${yAt(point.value).toFixed(1)}`).join(' ');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#f3f1ec');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);

  for (const [index, point] of points.entries()) {
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', xAt(index).toFixed(1));
    dot.setAttribute('cy', yAt(point.value).toFixed(1));
    dot.setAttribute('r', points.length > 40 ? '2' : '3');
    dot.setAttribute('fill', '#f3f1ec');
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${point.label}: ${point.value}`;
    dot.append(title);
    svg.append(dot);
  }
  return svg;
}

function band(svg: SVGSVGElement, y1: number, y2: number, fill: string) {
  const rect = document.createElementNS(NS, 'rect');
  const top = Math.min(y1, y2);
  rect.setAttribute('x', '0');
  rect.setAttribute('y', top.toFixed(1));
  rect.setAttribute('width', '320');
  rect.setAttribute('height', Math.abs(y2 - y1).toFixed(1));
  rect.setAttribute('fill', fill);
  svg.append(rect);
}
