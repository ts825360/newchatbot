import { unzipSync } from "fflate";

type Paragraph = { kind: "paragraph"; text: string; heading: boolean };
type Table = { kind: "table"; rows: { cells: string[]; header: boolean }[] };
export type WordPreview = { kind: "word"; blocks: (Paragraph | Table)[]; truncated: boolean };

const documentPath = "word/document.xml";
const namespaces = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);

export function readWordPreview(bytes: Uint8Array): WordPreview | null {
  let entries = 0, documentFound = false;
  const packageParts = unzipSync(bytes, { filter: part => {
    if (++entries > 2048) throw new Error("Too many package parts");
    if (part.name !== documentPath) return false;
    if (documentFound || part.size > bytes.length || part.originalSize < 1 || part.originalSize > 2 * 1024 * 1024) {
      throw new Error("Invalid document part");
    }
    documentFound = true;
    return true;
  } });
  const documentPart = packageParts[documentPath];
  if (!documentPart || documentPart.length > 2 * 1024 * 1024) return null;
  const source = new TextDecoder("utf-8", { fatal: true }).decode(documentPart);
  if (/<!DOCTYPE\b/i.test(source)) return null;
  const xml = new DOMParser().parseFromString(source, "application/xml");
  const root = xml.documentElement;
  const ns = root.namespaceURI ?? "";
  if (root.localName !== "document" || !namespaces.has(ns) || xml.getElementsByTagName("parsererror").length) return null;

  const children = (node: Element, name: string) => Array.from(node.children).filter(child => child.namespaceURI === ns && child.localName === name);
  const body = children(root, "body")[0];
  if (!body) return null;
  const preview: WordPreview = { kind: "word", blocks: [], truncated: false };
  let remaining = 100_000;
  let remainingCells = 1200;
  const paragraphText = (node: Element) => {
    const parts: string[] = [];
    for (const child of node.getElementsByTagNameNS(ns, "*")) {
      const text = child.localName === "t" ? child.textContent ?? "" : child.localName === "tab" ? "\t"
        : child.localName === "br" || child.localName === "cr" ? "\n" : "";
      if (text.length > remaining) preview.truncated = true;
      if (remaining > 0 && text) {
        const excerpt = text.slice(0, remaining);
        remaining -= excerpt.length;
        parts.push(excerpt);
      }
    }
    return parts.join("");
  };
  const visit = (parent: Element, depth = 0) => {
    for (const node of parent.children) {
      if (remaining === 0 || preview.blocks.length >= 240) { preview.truncated = true; break; }
      if (node.namespaceURI !== ns) continue;
      if (node.localName === "p") {
        const style = node.getElementsByTagNameNS(ns, "pStyle")[0]?.getAttributeNS(ns, "val") ?? "";
        preview.blocks.push({ kind: "paragraph", text: paragraphText(node), heading: /^(title|heading[1-9])$/i.test(style) });
      } else if (node.localName === "tbl") {
        const allRows = children(node, "tr");
        if (allRows.length > 100) preview.truncated = true;
        const rows: Table["rows"] = [];
        for (const row of allRows.slice(0, 100)) {
          if (!remainingCells || !remaining) { preview.truncated = true; break; }
          const cells = children(row, "tc");
          const visible = cells.slice(0, Math.min(24, remainingCells));
          if (visible.length < cells.length) preview.truncated = true;
          remainingCells -= visible.length;
          rows.push({ header: children(row, "trPr").some(props => children(props, "tblHeader").length > 0),
            cells: visible.map(cell => {
              const paragraphs = Array.from(cell.getElementsByTagNameNS(ns, "p"));
              if (paragraphs.length > 40) preview.truncated = true;
              return paragraphs.slice(0, 40).map(paragraphText).join("\n");
            }),
          });
        }
        if (rows.some(row => row.cells.length > 0)) preview.blocks.push({ kind: "table", rows });
      } else if (node.localName === "sdt" || node.localName === "sdtContent") {
        if (depth >= 8) preview.truncated = true;
        else visit(node, depth + 1);
      }
    }
  };
  visit(body);
  return preview;
}
