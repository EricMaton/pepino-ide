// Spike #21: isomorphic-git HTTP client over native HTTP (CapacitorHttp), so GitHub needs no CORS proxy.
// Bodies cross the bridge as base64 both ways ('file' request body, 'arraybuffer' response).
import { CapacitorHttp } from '@capacitor/core';
import { Buffer } from 'buffer';

interface GitHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: AsyncIterable<Uint8Array>;
}

async function collect(body: AsyncIterable<Uint8Array> | undefined): Promise<Uint8Array | undefined> {
  if (!body) return undefined;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export const httpStats = { requests: 0, bytesIn: 0, ms: 0 };

export const capacitorHttp = {
  async request({ url, method = 'GET', headers = {}, body }: GitHttpRequest) {
    const start = performance.now();
    const data = await collect(body);
    const response = await CapacitorHttp.request({
      url,
      method,
      headers,
      data: data ? Buffer.from(data).toString('base64') : undefined,
      dataType: data ? 'file' : undefined,
      responseType: 'arraybuffer',
    });
    const bytes = Buffer.from(response.data as string, 'base64');
    httpStats.requests++;
    httpStats.bytesIn += bytes.length;
    httpStats.ms += performance.now() - start;
    return {
      url: response.url,
      method,
      statusCode: response.status,
      statusMessage: String(response.status),
      headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), value])),
      body: (async function* () {
        yield new Uint8Array(bytes);
      })(),
    };
  },
};
