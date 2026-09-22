import { crc32 } from "node:zlib";

export type ParsedZipEntry = {
  name: string;
  data: Uint8Array;
  method: number;
  crc: number;
};

/**
 * Store 모드 ZIP을 파싱해 엔트리(이름·원본 데이터·CRC)를 꺼낸다.
 * buildZip / buildXlsx의 무결성을 검증하는 테스트 전용 헬퍼다.
 */
export function readZipEntries(bytes: Uint8Array): ParsedZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("EOCD 서명을 찾을 수 없음");

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ParsedZipEntry[] = [];

  for (let n = 0; n < count; n++) {
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const crc = dv.getUint32(ptr + 16, true);
    const localOffset = dv.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    const method = dv.getUint16(localOffset + 8, true);
    const compSize = dv.getUint32(localOffset + 18, true);
    const lNameLen = dv.getUint16(localOffset + 26, true);
    const lExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(dataStart, dataStart + compSize);

    if (crc32(data) !== crc) {
      throw new Error(`CRC 불일치: ${name}`);
    }

    entries.push({ name, data, method, crc });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}
