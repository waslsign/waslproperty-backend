import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailProviderError } from '../../src/lib/email/types.js';
import { ResendEmailProvider } from '../../src/lib/email/resendEmailProvider.js';

const validInput = {
  to: 'resident@example.com',
  subject: 'Lift maintenance this Thursday',
  html: '<p>Body</p>',
  text: 'Body',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ResendEmailProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends via the Resend HTTPS API and returns the provider message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'resend_msg_123' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ResendEmailProvider(
      're_test_key',
      'Wasl Property <no-reply@waslproperty.dev>',
    );
    const result = await provider.send(validInput);

    expect(result).toEqual({ providerMessageId: 'resend_msg_123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Wasl Property <no-reply@waslproperty.dev>',
      to: validInput.to,
      subject: validInput.subject,
      html: validInput.html,
      text: validInput.text,
    });
  });

  it('throws REQUEST_FAILED with the API error message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { message: 'Invalid `to` field' })),
    );

    const provider = new ResendEmailProvider('re_test_key', 'from@example.com');
    await expect(provider.send(validInput)).rejects.toMatchObject({
      name: 'EmailProviderError',
      code: 'REQUEST_FAILED',
      message: 'Invalid `to` field',
    });
  });

  it('throws REQUEST_FAILED with a generic message when the error body has no message field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})));

    const provider = new ResendEmailProvider('re_test_key', 'from@example.com');
    await expect(provider.send(validInput)).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      message: 'Resend request failed with status 500',
    });
  });

  it('throws TIMEOUT when the request is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }),
    );

    const provider = new ResendEmailProvider('re_test_key', 'from@example.com');
    await expect(provider.send(validInput)).rejects.toBeInstanceOf(EmailProviderError);
    await expect(provider.send(validInput)).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('throws UNAVAILABLE on a network-level failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')));

    const provider = new ResendEmailProvider('re_test_key', 'from@example.com');
    await expect(provider.send(validInput)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
