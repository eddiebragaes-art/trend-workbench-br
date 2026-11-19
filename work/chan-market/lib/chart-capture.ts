// Adicionado em trend-workbench-br: captura do gráfico em PNG com um clique.
// Runs only in the browser. The chart is a self-contained SVG, so it is cloned,
// its computed styles are inlined, and it is drawn onto a canvas with a title band.

const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'display', 'visibility'];

function inlineStyles(source: Element, target: Element) {
  const computed = getComputedStyle(source);
  const style = STYLE_PROPS.map(p => `${p}:${computed.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', `${target.getAttribute('style') ?? ''};${style}`);
  for (let i = 0; i < source.children.length; i++) inlineStyles(source.children[i], target.children[i]);
}

/** Pure helper (tested): a safe file name such as "XAUUSD-1h-2026-11-19_21-45.png". */
export function captureFileName(symbol: string, interval: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `${symbol.replace(/[^A-Za-z0-9._^-]+/g, '-')}-${interval}-${stamp}.png`;
}

export async function captureChartPng(svg: SVGSVGElement, title: string, subtitle: string): Promise<Blob> {
  const box = svg.getBoundingClientRect();
  const width = Math.round(box.width), height = Math.round(box.height), band = 44, scale = 2;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.style.width = `${width}px`; clone.style.height = `${height}px`;
  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('chart image failed')); image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = width * scale; canvas.height = (height + band) * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.scale(scale, scale);
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#0b131b';
    ctx.fillRect(0, 0, width, height + band);
    ctx.fillStyle = '#d8e4e4'; ctx.font = '600 16px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText(title, 16, band / 2);
    ctx.fillStyle = '#7f98a3'; ctx.font = '12px "Segoe UI", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(subtitle, width - 16, band / 2);
    ctx.drawImage(image, 0, band, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('png failed')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
