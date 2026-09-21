import { inferMimeType } from "~/lib/mime";

/**
 * 파일 이름에서 파일 시스템 및 URL에 유해한 특수문자를 정제합니다.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return cleaned.slice(0, 200) || "file";
}

/**
 * R2 버킷 저장 키를 생성합니다.
 */
export function buildSubmissionR2Key(
  assignmentId: string,
  ownerKey: string,
  filename: string
): string {
  const safeName = sanitizeFilename(filename);
  const uuid = crypto.randomUUID();
  return `submissions/${assignmentId}/${ownerKey}/${uuid}-${safeName}`;
}

/**
 * File 객체를 V8 힙에 버퍼링(ArrayBuffer)하지 않고,
 * ReadableStream을 R2 버킷에 직접 파이프라인으로 연결하여 업로드합니다 (Zero-Heap Buffering).
 */
export async function uploadStreamToR2(
  r2: R2Bucket,
  key: string,
  file: File,
  mime: string
): Promise<void> {
  await r2.put(key, file.stream(), {
    httpMetadata: { contentType: mime },
  });
}

/**
 * R2 스트림을 클라이언트에 서빙하기 위한 Web 표준 Response를 조립합니다.
 */
export function buildFileStreamResponse(
  filename: string,
  rawMime: string | null | undefined,
  body: ReadableStream,
  inline = false
): Response {
  const disposition = inline ? "inline" : "attachment";
  const encodedName = encodeURIComponent(filename);
  const mimeType = inferMimeType(filename, rawMime ?? undefined);

  return new Response(body, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}
