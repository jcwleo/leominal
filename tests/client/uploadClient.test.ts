import { describe, expect, it, vi } from 'vitest';
import { UploadClientError, uploadFiles } from '../../src/client/api/uploadClient.js';

describe('uploadFiles', () => {
  it('posts a manifest and files with credentials through XMLHttpRequest', async () => {
    const xhr = new FakeXhr();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const responsePromise = uploadFiles({
      terminalId: 'term-alpha',
      files: [{ relativePath: 'hello.txt', file }],
      createXhr: () => xhr as unknown as XMLHttpRequest
    });

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/uploads');
    expect(xhr.withCredentials).toBe(true);
    const body = xhr.body as FormData;
    expect(JSON.parse(String(body.get('manifest')))).toEqual({
      terminalId: 'term-alpha',
      entries: [{ fieldName: 'file0', relativePath: 'hello.txt', size: 5 }]
    });
    expect(body.get('file0')).toBe(file);

    xhr.respond(
      200,
      JSON.stringify({
        destinationCwd: '/tmp/work',
        uploaded: 1,
        failed: 0,
        results: [{ relativePath: 'hello.txt', savedRelativePath: 'hello.txt', status: 'uploaded', size: 5 }]
      })
    );

    await expect(responsePromise).resolves.toMatchObject({ destinationCwd: '/tmp/work', uploaded: 1, failed: 0 });
  });

  it('reports upload progress from XMLHttpRequest upload events', async () => {
    const xhr = new FakeXhr();
    const onProgress = vi.fn();
    const responsePromise = uploadFiles({
      terminalId: 'term-alpha',
      files: [{ relativePath: 'hello.txt', file: new File(['hello'], 'hello.txt') }],
      onProgress,
      createXhr: () => xhr as unknown as XMLHttpRequest
    });

    xhr.progress(2, 5);
    xhr.respond(200, JSON.stringify({ destinationCwd: '/tmp/work', uploaded: 1, failed: 0, results: [] }));

    await responsePromise;
    expect(onProgress).toHaveBeenCalledWith({ loaded: 2, total: 5, percent: 40 });
  });

  it('parses JSON error responses from failed uploads', async () => {
    const xhr = new FakeXhr();
    const responsePromise = uploadFiles({
      terminalId: 'term-alpha',
      files: [{ relativePath: 'oversized.bin', file: new File(['too large'], 'oversized.bin') }],
      createXhr: () => xhr as unknown as XMLHttpRequest
    });

    xhr.respond(413, JSON.stringify({ error: 'upload_batch_too_large' }));

    await expect(responsePromise).rejects.toMatchObject(new UploadClientError(413, 'upload_batch_too_large'));
  });
});

class FakeXhr {
  method = '';
  url = '';
  withCredentials = false;
  status = 0;
  responseText = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  upload: XMLHttpRequestUpload = {
    onprogress: null
  } as XMLHttpRequestUpload;
  onload: ((this: XMLHttpRequest, event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onerror: ((this: XMLHttpRequest, event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onabort: ((this: XMLHttpRequest, event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  ontimeout: ((this: XMLHttpRequest, event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.body = body ?? null;
  }

  respond(status: number, responseText: string) {
    this.status = status;
    this.responseText = responseText;
    this.onload?.call(this as unknown as XMLHttpRequest, { type: 'load' } as ProgressEvent<XMLHttpRequestEventTarget>);
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.call(
      this as unknown as XMLHttpRequest,
      { type: 'progress', lengthComputable: true, loaded, total } as ProgressEvent<XMLHttpRequestEventTarget>
    );
  }
}
