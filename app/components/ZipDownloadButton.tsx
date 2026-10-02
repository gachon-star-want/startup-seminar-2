import { useRef, useState } from "react";
import { downloadZip } from "client-zip";
import { formatBytes } from "~/components/ui";

type ManifestFile = { name: string; url: string; size: number };
type ZipManifest = { zipName: string; totalBytes: number; files: ManifestFile[] };

type Phase =
  | { state: "idle" }
  | { state: "running"; done: number; total: number; bytes: number; totalBytes: number; current: string }
  | { state: "done"; skipped: number }
  | { state: "error"; message: string };

/** File System Access API 최소 타입 — lib.dom 버전 차이에 흔들리지 않게 직접 선언 */
type SavePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

const ZIP_PICKER_TYPES = [{ description: "ZIP 파일", accept: { "application/zip": [".zip"] } }];

/**
 * "ZIP 다운로드" 버튼 — 서버에서 파일 목록만 받고 브라우저가 파일을 하나씩 받아
 * ZIP으로 조립한다. 서버(Workers)는 메모리 128MB/CPU 한도 때문에 큰 ZIP을 못
 * 만들지만, 브라우저에서 조립하면 용량 제한이 사실상 없다.
 *
 * - Chromium 계열: showSaveFilePicker로 디스크에 직접 스트리밍 (메모리 버퍼 없음)
 * - 미지원 브라우저(Safari/Firefox): blob으로 조립 후 일반 다운로드 (브라우저 메모리 사용)
 */
export function ZipDownloadButton({
  manifestUrl,
  suggestedName,
  label,
  title,
}: {
  manifestUrl: string;
  suggestedName: string;
  label: string;
  title?: string;
}) {
  const [phase, setPhase] = useState<Phase>({ state: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;

    // 저장 위치는 사용자 제스처가 살아있을 때 가장 먼저 연다
    let writable: WritableStream<Uint8Array> | null = null;
    const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (typeof picker === "function") {
      try {
        const handle = await picker.call(window, {
          suggestedName,
          types: ZIP_PICKER_TYPES,
        });
        writable = await handle.createWritable();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // 사용자가 저장 취소
        writable = null; // 피커 실패 시 blob 폴백으로 진행
      }
    }

    setPhase({ state: "running", done: 0, total: 0, bytes: 0, totalBytes: 0, current: "" });

    try {
      const res = await fetch(manifestUrl, { signal: controller.signal });
      if (!res.ok) throw new Error((await res.text()).trim() || "파일 목록을 불러오지 못했어요.");
      const manifest = (await res.json()) as ZipManifest;
      if (manifest.files.length === 0) throw new Error("내려받을 첨부 파일이 없어요.");

      let done = 0;
      let received = 0;
      let skipped = 0;
      const { files, totalBytes } = manifest;

      // 한 파일씩 순차 받아 흘려보낸다 — 메모리에 파일 하나만 올라간다
      async function* entryStream() {
        for (const f of files) {
          if (controller.signal.aborted) return;
          try {
            const fileRes = await fetch(f.url, { signal: controller.signal });
            if (!fileRes.ok || !fileRes.body) {
              skipped++; // 스토리지에서 유실된 파일은 건너뛴다
              continue;
            }
            yield { name: f.name, input: fileRes };
            done++; // yield가 풀린 시점 = 이 파일이 zip에 완전히 기록된 시점
            received += f.size;
            setPhase({
              state: "running",
              done,
              total: files.length,
              bytes: received,
              totalBytes,
              current: f.name,
            });
          } catch (e) {
            if (controller.signal.aborted) return;
            skipped++;
          }
        }
      }

      const zip = downloadZip(entryStream());

      if (writable) {
        await zip.body!.pipeTo(writable, { signal: controller.signal });
      } else {
        // File System Access API 미지원 브라우저 폴백 — 메모리에 blob으로 조립
        const blob = await zip.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = manifest.zipName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      }

      if (done === 0) {
        throw new Error("파일을 하나도 내려받지 못했어요 (스토리지에서 유실되었을 수 있어요).");
      }
      setPhase({ state: "done", skipped });
    } catch (e) {
      if (controller.signal.aborted) {
        setPhase({ state: "idle" });
      } else {
        setPhase({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
      if (writable) {
        try {
          await writable.abort();
        } catch {}
      }
    }
  }

  if (phase.state === "running") {
    return (
      <span className="cluster">
        <button type="button" className="btn btn--ghost btn--sm" disabled>
          📦 {phase.done}/{phase.total || "?"} 조립 중…
        </button>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => abortRef.current?.abort()}>
          취소
        </button>
        <span className="small faint num">
          {formatBytes(phase.bytes)} / {formatBytes(phase.totalBytes)}
          {phase.current ? ` · ${phase.current}` : ""}
        </span>
      </span>
    );
  }

  return (
    <span className="cluster">
      <button type="button" className="btn btn--ghost btn--sm" onClick={start} title={title}>
        {label}
      </button>
      {phase.state === "done" ? (
        <span className="small text-success">
          ✅ 완료{phase.skipped > 0 ? ` (누락 ${phase.skipped}개)` : ""}
        </span>
      ) : null}
      {phase.state === "error" ? <span className="small text-danger">⚠️ {phase.message}</span> : null}
    </span>
  );
}
