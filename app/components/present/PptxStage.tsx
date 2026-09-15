import { useEffect, useRef, useState } from "react";

type Previewer = {
  slideCount: number;
  currentIndex: number;
  preview(file: ArrayBuffer): Promise<unknown>;
  renderNextSlide(): void;
  renderPreSlide(): void;
  destroy(): void;
};

export default function PptxStage({
  url,
  page,
  boxW,
  boxH,
  onTotal,
  onUnavailable,
}: {
  url: string;
  page: number;
  boxW: number;
  boxH: number;
  onTotal: (n: number) => void;
  onUnavailable?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const previewerRef = useRef<Previewer | null>(null);
  const [failed, setFailed] = useState(false);

  // 스테이지 크기(url/boxW/boxH)가 바뀌면 렌더러를 다시 초기화
  useEffect(() => {
    let disposed = false;
    let pv: Previewer | null = null;
    previewerRef.current = null;

    (async () => {
      try {
        const [{ init }, res] = await Promise.all([import("pptx-preview"), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (disposed || !hostRef.current) return;
        pv = init(hostRef.current, {
          width: Math.max(320, Math.floor(boxW)),
          height: Math.max(180, Math.floor(boxH)),
          mode: "slide",
        }) as Previewer;
        previewerRef.current = pv;
        await pv.preview(buf);
        if (disposed) return;
        onTotal(pv.slideCount);
        syncPage(page, pv);
      } catch {
        // 구형 .ppt 등 파싱 불가 형식 → 다운로드 폴백으로 전환
        if (!disposed) {
          setFailed(true);
          onUnavailable?.();
        }
      }
    })();

    return () => {
      disposed = true;
      pv?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, boxW, boxH]);

  // 우리 키맵(스페이스/백스페이스) → 렌더러 페이지 동기화
  useEffect(() => {
    syncPage(page, previewerRef.current);
  }, [page]);

  if (failed) {
    return (
      <div className="present-fallback">
        <p className="present-fallback__title">이 파일은 브라우저에서 바로 표시할 수 없어요</p>
        <div className="cluster">
          <a href={url} className="present-btn present-btn--solid">
            다운로드
          </a>
          <a href={`${url}?inline=1`} className="present-btn" target="_blank" rel="noreferrer">
            새 탭에서 열기
          </a>
        </div>
      </div>
    );
  }

  return <div ref={hostRef} className="present-pptx-host" />;
}

function syncPage(page: number, pv: Previewer | null) {
  if (!pv) return;
  let guard = 500;
  while (pv.currentIndex < page && guard-- > 0) pv.renderNextSlide();
  while (pv.currentIndex > page && guard-- > 0) pv.renderPreSlide();
}
