import {
  downloadLeadImage,
  isPublicImageAddress,
  RemoteImageError,
} from './lead-remote-image';

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
describe('private remote image download guard', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '192.168.0.1',
    '100.100.100.200',
    '::1',
    '::ffff:127.0.0.1',
    '2001:db8::1',
  ])('blocks %s', (address) => {
    expect(isPublicImageAddress(address)).toBe(false);
  });
  it('pins the validated address and checks every redirect', async () => {
    const transport = jest.fn().mockResolvedValueOnce({
      status: 302,
      headers: { location: 'https://private.example/image' },
      body: new Uint8Array(),
    });
    const resolve = jest.fn(async (host: string) =>
      host === 'public.example'
        ? [{ address: '8.8.8.8', family: 4 as const }]
        : [{ address: '127.0.0.1', family: 4 as const }],
    );
    await expect(
      downloadLeadImage('https://public.example/image', { resolve, transport }),
    ).rejects.toThrow(RemoteImageError);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]).toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });
  it('rejects mixed public and private DNS answers before transport', async () => {
    const transport = jest.fn();
    await expect(
      downloadLeadImage('https://public.example/a', {
        resolve: async () => [
          { address: '8.8.8.8', family: 4 },
          { address: '169.254.169.254', family: 4 },
        ],
        transport,
      }),
    ).rejects.toThrow(RemoteImageError);
    expect(transport).not.toHaveBeenCalled();
  });
  it('checks both declared and actual image type', async () => {
    const dependencies = {
      resolve: async () => [{ address: '8.8.8.8', family: 4 as const }],
      transport: async () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: png,
      }),
    };
    await expect(
      downloadLeadImage('https://public.example/a', dependencies),
    ).resolves.toEqual({ bytes: png, mimeType: 'image/png' });
    await expect(
      downloadLeadImage('https://u:p@public.example/a', dependencies),
    ).rejects.toThrow(RemoteImageError);
    await expect(
      downloadLeadImage('https://public.example/a', {
        ...dependencies,
        transport: async () => ({
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: png,
        }),
      }),
    ).rejects.toThrow(RemoteImageError);
  });
});
