import { useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// options 객체가 렌더마다 새로 만들어지면 react-pdf가 문서를 다시 읽으므로 모듈 레벨로 고정
const docOptions = {} as const;

export default function PdfStage({
  url,
  page,
  boxW,
  boxH,
  onTotal,
}: {
  url: string;
  page: number;
  boxW: number;
  boxH: number;
  onTotal: (n: number) => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null); // 페이지 가로/세로 비율
  const [error, setError] = useState(false);

  const fitW = ratio ? Math.min(boxW, boxH * ratio) : boxW;

  if (error) {
    return (
      <div className="present-fallback">
        <p className="present-fallback__title">PDF를 표시할 수 없어요</p>
        <a href={url} className="present-btn present-btn--solid" target="_blank" rel="noreferrer">
          새 탭에서 열기
        </a>
      </div>
    );
  }

  return (
    <Document
      file={url}
      options={docOptions}
      onLoadSuccess={async (pdf) => {
        onTotal(pdf.numPages);
        try {
          const p1 = await pdf.getPage(1);
          const vp = p1.getViewport({ scale: 1 });
          setRatio(vp.width / vp.height);
        } catch {
          // 비율을 못 구하면 폭 기준으로만 맞춤
        }
      }}
      onLoadError={() => setError(true)}
      loading={<p className="present-loading">PDF 불러오는 중…</p>}
      error={null}
    >
      <Page
        pageNumber={page + 1}
        width={Math.max(320, Math.floor(fitW))}
        renderTextLayer={false}
        renderAnnotationLayer={false}
        loading={<p className="present-loading">페이지 렌더링 중…</p>}
      />
    </Document>
  );
}
