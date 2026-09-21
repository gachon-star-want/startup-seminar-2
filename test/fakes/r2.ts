/**
 * In-Memory Fake Cloudflare R2 Bucket for unit and integration testing.
 * Zero I/O, runs entirely in Node.js/WASM memory in under 1ms.
 */

export interface StoredObject {
  data: Uint8Array;
  size: number;
  mime?: string;
  customMetadata?: Record<string, string>;
}

export class FakeR2Bucket {
  private storage = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string | null,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }
  ) {
    let bytes: Uint8Array;

    if (value === null) {
      bytes = new Uint8Array(0);
    } else if (typeof value === "string") {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else if (value instanceof Blob) {
      bytes = new Uint8Array(await value.arrayBuffer());
    } else if (typeof (value as any).getReader === "function" || value instanceof ReadableStream) {
      const response = new Response(value);
      bytes = new Uint8Array(await response.arrayBuffer());
    } else {
      bytes = new Uint8Array(0);
    }

    const stored: StoredObject = {
      data: bytes,
      size: bytes.byteLength,
      mime: options?.httpMetadata?.contentType,
      customMetadata: options?.customMetadata,
    };

    this.storage.set(key, stored);

    return {
      key,
      size: stored.size,
      etag: "fake-etag-" + key,
      httpMetadata: options?.httpMetadata ?? {},
      customMetadata: options?.customMetadata ?? {},
    };
  }

  async get(key: string) {
    const item = this.storage.get(key);
    if (!item) return null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(item.data);
        controller.close();
      },
    });

    return {
      key,
      size: item.size,
      httpMetadata: { contentType: item.mime },
      customMetadata: item.customMetadata ?? {},
      body: stream,
      arrayBuffer: async () => item.data.buffer,
      text: async () => new TextDecoder().decode(item.data),
    };
  }

  async delete(keys: string | string[]) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      this.storage.delete(k);
    }
  }

  // Helper test methods
  has(key: string): boolean {
    return this.storage.has(key);
  }

  clear(): void {
    this.storage.clear();
  }

  count(): number {
    return this.storage.size;
  }
}

export function createFakeR2(): FakeR2Bucket {
  return new FakeR2Bucket();
}
