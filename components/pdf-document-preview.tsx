"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { Button } from "./ui";

export function PdfDocumentPreview({ blob }: { blob: Blob }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const annotationMode = useRef(0);

  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    const load = async () => {
      try {
        const [pdf, data] = await Promise.all([import("pdfjs-dist"), blob.arrayBuffer()]);
        if (!active) return;
        pdf.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        annotationMode.current = pdf.AnnotationMode.DISABLE;
        task = pdf.getDocument({ data, enableXfa: false, useWasm: false, maxImageSize: 16_000_000 });
        const result = await task.promise;
        if (active) setDocument(result);
      } catch {
        if (active) setError("PDF를 열지 못했습니다. 원본을 다운로드해 확인해 주세요.");
      }
    };
    void load();
    return () => { active = false; if (task) void task.destroy().catch(() => {}); };
  }, [blob]);

  useEffect(() => {
    const target = canvas.current;
    if (!document || !target) return;
    let active = true;
    let rendering: RenderTask | undefined;
    setLoading(true);
    setError("");
    frame.current?.closest(".documents-viewer-body")?.scrollTo({ top: 0 });
    const render = async () => {
      try {
        const pdfPage = await document.getPage(page);
        if (!active) return;
        const size = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(2, 1200 / size.width, 1600 / size.height) });
        target.width = Math.max(1, Math.ceil(viewport.width));
        target.height = Math.max(1, Math.ceil(viewport.height));
        rendering = pdfPage.render({ canvas: target, viewport, annotationMode: annotationMode.current, background: "#fff" });
        await rendering.promise;
      } catch {
        if (active) setError("이 페이지를 표시하지 못했습니다. 원본을 다운로드해 확인해 주세요.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void render();
    return () => { active = false; rendering?.cancel(); };
  }, [document, page]);

  return <div className="documents-pdf" ref={frame}>
    {document && <nav className="documents-pdf-toolbar" aria-label="PDF 페이지">
      <Button type="button" variant="outline" className="documents-viewer-icon" title="이전 페이지" aria-label="이전 페이지" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={17} aria-hidden="true" /></Button>
      <span aria-live="polite">{page} / {document.numPages}</span>
      <Button type="button" variant="outline" className="documents-viewer-icon" title="다음 페이지" aria-label="다음 페이지" disabled={page >= document.numPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={17} aria-hidden="true" /></Button>
    </nav>}
    {error ? <p role="alert" className="documents-viewer-message documents-error">{error}</p>
      : loading && <p role="status" className="documents-viewer-message">PDF 불러오는 중...</p>}
    {document && <canvas ref={canvas} hidden={loading || !!error} role="img" aria-label={`PDF ${page}페이지`} />}
  </div>;
}
