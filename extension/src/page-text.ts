// Read rendered, accessible documents. Cross-origin frames and PDF viewers
// cannot be inspected through the DOM and are never fetched by the extension.
const MAX_CHARS = 120_000;
const MAX_FRAMES = 12;
const MAX_DEPTH = 3;

export interface PageText {
  text: string;
  truncated: boolean;
  documents: Document[];
}

export function readPageText(root: Document): PageText {
  const documents = [root];
  const chunks: string[] = [];
  let length = 0;
  let frameCount = 0;
  let truncated = false;

  function read(document: Document, depth: number): void {
    const visible = document.body?.innerText ?? '';
    if (visible.trim()) {
      const separator = chunks.length ? '\n\n' : '';
      const room = Math.max(0, MAX_CHARS - length - separator.length);
      let part = visible.slice(0, room);
      if (/[\uD800-\uDBFF]$/.test(part)) part = part.slice(0, -1);
      truncated ||= part.length < visible.length;
      if (part) {
        chunks.push(separator, part);
        length += separator.length + part.length;
      }
    }

    for (const frame of document.querySelectorAll<HTMLIFrameElement | HTMLObjectElement>('iframe, object')) {
      if (!frame.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      // Chrome returns null for inaccessible frame documents. Requiring the
      // same origin is also enforced by the DOM's contentDocument getter.
      const embedded = frame.contentDocument;
      if (!embedded?.body || documents.includes(embedded)) continue;
      if (length === MAX_CHARS || depth >= MAX_DEPTH || frameCount >= MAX_FRAMES) {
        truncated = true;
        break;
      }
      frameCount += 1;
      documents.push(embedded);
      read(embedded, depth + 1);
    }
  }

  read(root, 0);
  return { text: chunks.join(''), truncated, documents };
}
