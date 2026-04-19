/* eslint-env jest */

const mockDetector = jest.fn()
function detector(...args: any[]) {
  return mockDetector.apply(null, args)
}

const mockIsAnimated = jest.fn(() => false)
function isAnimated(...args: any[]) {
  return mockIsAnimated.apply(null, args)
}

const mockTransformer = {
  timeout: jest.fn().mockReturnThis(),
  rotate: jest.fn().mockReturnThis(),
  resize: jest.fn().mockReturnThis(),
  avif: jest.fn().mockReturnThis(),
  webp: jest.fn().mockReturnThis(),
  png: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  toBuffer: jest.fn(async () => Buffer.from('optimized-image')),
}

const mockSharpImpl = jest.fn(() => mockTransformer)
function sharp(...args: any[]) {
  return mockSharpImpl.apply(null, args)
}

Object.assign(sharp, {
  concurrency: jest.fn((value?: number) => {
    if (typeof value === 'number') {
      return undefined
    }

    return 2
  }),
})

jest.mock('next/dist/compiled/image-detector/detector.js', () => ({
  detector,
}))
jest.mock('next/dist/compiled/is-animated', () => isAnimated)
jest.mock('sharp', () => sharp)

import {
  extractEtag,
  detectContentType,
  fetchExternalImage,
  fetchInternalImage,
  getHash,
  getImageEtag,
  getImageSize,
  getMaxAge,
  getPreviouslyCachedImageOrNull,
  ImageError,
  ImageOptimizerCache,
  imageOptimizer,
  optimizeImage,
  sendResponse,
} from './image-optimizer'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

function createReq(accept = 'image/webp,image/*,*/*') {
  return {
    headers: {
      accept,
    },
  } as any
}

function createNextConfig(overrides: any = {}) {
  const {
    images: imageOverrides = {},
    experimental: experimentalOverrides = {},
    ...restOverrides
  } = overrides

  return {
    basePath: '',
    images: {
      deviceSizes: [16, 32, 64],
      imageSizes: [24],
      domains: [],
      localPatterns: undefined,
      remotePatterns: [],
      minimumCacheTTL: 60,
      formats: ['image/webp'],
      qualities: [75],
      dangerouslyAllowSVG: false,
      maximumDiskCacheSize: 0,
      loader: 'default',
      unoptimized: false,
      contentDispositionType: 'attachment',
      contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
      ...imageOverrides,
    },
    experimental: {
      imgOptConcurrency: undefined,
      imgOptMaxInputPixels: undefined,
      imgOptSequentialRead: undefined,
      imgOptSkipMetadata: true,
      imgOptTimeoutInSeconds: undefined,
      isrFlushToDisk: false,
      ...experimentalOverrides,
    },
    ...restOverrides,
  } as any
}

function createHeaders(values: Record<string, string | null | undefined>) {
  return {
    get(name: string) {
      const key = Object.keys(values).find(
        (k) => k.toLowerCase() === name.toLowerCase()
      )
      return key ? (values[key] ?? null) : null
    },
  }
}

async function* createBody(chunks: Array<string | Buffer>) {
  for (const chunk of chunks) {
    yield typeof chunk === 'string' ? Buffer.from(chunk) : chunk
  }
}

function createMockServerResponse() {
  const headers = new Map<string, any>()
  let endedWith: any = undefined
  const res = {
    statusCode: 200,
    setHeader(name: string, value: any) {
      headers.set(name.toLowerCase(), value)
      return this
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
    end(value?: any) {
      endedWith = value
      return this
    },
  } as any

  return {
    res,
    headers,
    getEndedWith: () => endedWith,
  }
}

describe('image-optimizer helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockDetector.mockReturnValue(undefined)
    mockIsAnimated.mockReturnValue(false)
  })

  it('detects common image signatures and detector fallbacks', async () => {
    mockDetector.mockReturnValueOnce(undefined)
    await expect(detectContentType(Buffer.alloc(0), true)).resolves.toBeNull()

    await expect(
      detectContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00]), true)
    ).resolves.toBe('image/jpeg')

    await expect(
      detectContentType(Buffer.from('<svg></svg>'), true)
    ).resolves.toBe('image/svg+xml')

    await expect(
      detectContentType(
        Buffer.from([
          0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42,
          0x50,
        ]),
        true
      )
    ).resolves.toBe('image/webp')
  })

  it.each([
    {
      bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      expected: 'image/png',
    },
    { bytes: [0x47, 0x49, 0x46, 0x38], expected: 'image/gif' },
    {
      bytes: [
        0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
      ],
      expected: 'image/avif',
    },
    { bytes: [0x00, 0x00, 0x01, 0x00], expected: 'image/x-icon' },
    { bytes: [0x69, 0x63, 0x6e, 0x73], expected: 'image/x-icns' },
    { bytes: [0x49, 0x49, 0x2a, 0x00], expected: 'image/tiff' },
    { bytes: [0x42, 0x4d], expected: 'image/bmp' },
    { bytes: [0xff, 0x0a], expected: 'image/jxl' },
    {
      bytes: [
        0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      ],
      expected: 'image/heic',
    },
    { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], expected: 'application/pdf' },
    {
      bytes: [
        0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      ],
      expected: 'image/jp2',
    },
  ])('detects signature %#', async ({ bytes, expected }) => {
    await expect(detectContentType(Buffer.from(bytes), true)).resolves.toBe(
      expected
    )
  })

  it('parses cache-control headers and image error status codes', () => {
    expect(getMaxAge('public, max-age=120')).toBe(120)
    expect(getMaxAge('public, s-maxage="45"')).toBe(45)
    expect(getMaxAge(undefined)).toBe(0)

    expect(
      getPreviouslyCachedImageOrNull(
        {
          buffer: Buffer.from('image'),
          contentType: 'image/png',
          cacheControl: 'public, max-age=120',
          etag: 'etag-1',
        },
        {
          value: {
            kind: 'IMAGE',
            buffer: Buffer.from('cached'),
            etag: 'etag-2',
            upstreamEtag: 'etag-1',
            extension: 'png',
          },
        } as any
      )
    ).toEqual({
      kind: 'IMAGE',
      buffer: Buffer.from('cached'),
      etag: 'etag-2',
      upstreamEtag: 'etag-1',
      extension: 'png',
    })

    expect(new ImageError(200, 'nope').statusCode).toBe(500)
    expect(new ImageError(404, 'nope').statusCode).toBe(404)
  })

  it('covers hash and etag helper behavior', () => {
    const hash = getHash(['a', 1, Buffer.from('b')])
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(10)

    const image = Buffer.from('image-data')
    expect(getImageEtag(image)).toBe(getHash([image]))

    expect(extractEtag('W/"upstream"', image)).toBe(
      Buffer.from('W/"upstream"').toString('base64url')
    )
    expect(extractEtag(null, image)).toBe(getImageEtag(image))
  })

  it('returns image dimensions for a valid png', async () => {
    const oneByOnePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2l0ZYAAAAASUVORK5CYII=',
      'base64'
    )

    await expect(getImageSize(oneByOnePng)).resolves.toEqual({
      width: 1,
      height: 1,
    })
  })

  it('throws a helpful error when sharp is unavailable', () => {
    jest.resetModules()
    jest.doMock('sharp', () => {
      const error = new Error('Cannot find module sharp') as Error & {
        code?: string
      }
      error.code = 'MODULE_NOT_FOUND'
      throw error
    })

    const { getSharp: getSharpWithoutSharp } =
      require('./image-optimizer') as typeof import('./image-optimizer')

    expect(() => getSharpWithoutSharp(undefined)).toThrow(
      'Module `sharp` not found. Please run `npm install --cpu=wasm32 sharp` to install it.'
    )

    jest.doMock('sharp', () => sharp)
    jest.resetModules()
  })
})

describe('ImageOptimizerCache.validateParams', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([
    { query: {}, errorMessage: '"url" parameter is required' },
    {
      query: { url: ['one', 'two'] },
      errorMessage: '"url" parameter cannot be an array',
    },
    {
      query: { url: 'x'.repeat(3073) },
      errorMessage: '"url" parameter is too long',
    },
    {
      query: { url: '//example.com/image.png' },
      errorMessage: '"url" parameter cannot be a protocol-relative URL (//)',
    },
    {
      query: { url: '/_next/image?url=%2Fimage.png&w=16&q=75' },
      errorMessage: '"url" parameter cannot be recursive',
    },
    {
      query: { url: '/blocked.png' },
      errorMessage: '"url" parameter is not allowed',
      nextConfig: createNextConfig({
        images: {
          localPatterns: [{ pathname: '/allowed/**' }],
        },
      }),
    },
    {
      query: { url: 'not-a-url' },
      errorMessage: '"url" parameter is invalid',
    },
    {
      query: { url: 'ftp://example.com/image.png' },
      errorMessage: '"url" parameter is invalid',
    },
    {
      query: { url: 'https://example.com/image.png' },
      errorMessage: '"url" parameter is not allowed',
      nextConfig: createNextConfig({
        images: {
          remotePatterns: [{ protocol: 'https', hostname: 'cdn.example.com' }],
        },
      }),
    },
    {
      query: { url: '/image.png', w: ['16'], q: '75' },
      errorMessage: '"w" parameter (width) cannot be an array',
    },
    {
      query: { url: '/image.png', w: 'abc', q: '75' },
      errorMessage: '"w" parameter (width) must be an integer greater than 0',
    },
    {
      query: { url: '/image.png', w: '0', q: '75' },
      errorMessage: '"w" parameter (width) must be an integer greater than 0',
    },
    {
      query: { url: '/image.png', w: '16' },
      errorMessage: '"q" parameter (quality) is required',
    },
    {
      query: { url: '/image.png', w: '16', q: ['75'] },
      errorMessage: '"q" parameter (quality) cannot be an array',
    },
    {
      query: { url: '/image.png', w: '16', q: 'abc' },
      errorMessage:
        '"q" parameter (quality) must be an integer between 1 and 100',
    },
    {
      query: { url: '/image.png', w: '16', q: '101' },
      errorMessage:
        '"q" parameter (quality) must be an integer between 1 and 100',
    },
    {
      query: { url: '/image.png', w: '48', q: '75' },
      errorMessage: '"w" parameter (width) of 48 is not allowed',
    },
    {
      query: { url: '/image.png', w: '16', q: '80' },
      errorMessage: '"q" parameter (quality) of 80 is not allowed',
      nextConfig: createNextConfig({
        images: {
          qualities: [75],
        },
      }),
    },
  ])(
    'returns an error for invalid params %#',
    ({ query, errorMessage, nextConfig }) => {
      const result = ImageOptimizerCache.validateParams(
        createReq(),
        query as any,
        nextConfig ?? createNextConfig(),
        false
      )

      expect(result).toEqual({ errorMessage })
    }
  )

  it('accepts local images in dev mode, including the blur placeholder boundary values', () => {
    const result = ImageOptimizerCache.validateParams(
      createReq('image/webp,image/*,*/*'),
      { url: '/_next/static/media/test.png', w: '8', q: '70' },
      createNextConfig({
        images: {
          deviceSizes: [16],
          imageSizes: [],
          localPatterns: [{ pathname: '/_next/static/media/**' }],
          qualities: [75],
        },
      }),
      true
    )

    expect(result).toMatchObject({
      href: '/_next/static/media/test.png',
      isAbsolute: false,
      isStatic: true,
      width: 8,
      quality: 70,
      mimeType: 'image/webp',
      minimumCacheTTL: 60,
    })
  })

  it('accepts remote images when the remote pattern matches', () => {
    const result = ImageOptimizerCache.validateParams(
      createReq('image/png'),
      { url: 'https://cdn.example.com/photo.png', w: '16', q: '75' },
      createNextConfig({
        images: {
          remotePatterns: [
            { protocol: 'https', hostname: 'cdn.example.com', pathname: '/**' },
          ],
        },
      }),
      false
    )

    expect(result).toMatchObject({
      href: 'https://cdn.example.com/photo.png',
      isAbsolute: true,
      width: 16,
      quality: 75,
      mimeType: '',
    })
  })

  it('warns on deprecated domain config while still validating a remote image', () => {
    const result = ImageOptimizerCache.validateParams(
      createReq('image/png'),
      { url: 'https://example.com/photo.png', w: '16', q: '75' },
      createNextConfig({
        images: {
          domains: ['example.com'],
        },
      }),
      false
    )

    expect(result).toMatchObject({
      href: 'https://example.com/photo.png',
      isAbsolute: true,
      width: 16,
      quality: 75,
    })
  })

  it('negotiates mimeType from Accept headers across avif/webp fallbacks', () => {
    const avifResult = ImageOptimizerCache.validateParams(
      createReq('image/avif,image/webp,image/*,*/*'),
      { url: '/image.png', w: '16', q: '75' },
      createNextConfig({ images: { formats: ['image/avif', 'image/webp'] } }),
      false
    )

    expect(avifResult).toMatchObject({ mimeType: 'image/avif' })

    const webpResult = ImageOptimizerCache.validateParams(
      createReq('image/webp,image/*,*/*'),
      { url: '/image.png', w: '16', q: '75' },
      createNextConfig({ images: { formats: ['image/avif', 'image/webp'] } }),
      false
    )

    expect(webpResult).toMatchObject({ mimeType: 'image/webp' })

    const genericAcceptResult = ImageOptimizerCache.validateParams(
      createReq('image/*,*/*'),
      { url: '/image.png', w: '16', q: '75' },
      createNextConfig({ images: { formats: ['image/avif', 'image/webp'] } }),
      false
    )

    expect(genericAcceptResult).toMatchObject({ mimeType: '' })
  })
})

describe('fetchExternalImage', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it.each([404, 500, 503])(
    'rejects non-ok upstream status %s',
    async (statusCode) => {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: statusCode,
        headers: createHeaders({}),
        body: createBody([]),
      })) as any

      await expect(
        fetchExternalImage('https://example.com/image.png', true, 1024)
      ).rejects.toMatchObject({
        statusCode,
        message: '"url" parameter is valid but upstream response is invalid',
      })
    }
  )

  it('rejects timeout errors from upstream fetch', async () => {
    global.fetch = jest.fn(async () => {
      const err = new Error('timeout')
      ;(err as any).name = 'TimeoutError'
      throw err
    }) as any

    await expect(
      fetchExternalImage('https://example.com/image.png', true, 1024)
    ).rejects.toMatchObject({
      statusCode: 504,
      message: '"url" parameter is valid but upstream response timed out',
    })
  })

  it('rejects redirect loops after the maximum redirect count', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 302,
      headers: createHeaders({ Location: '/next-hop.png' }),
      body: createBody([]),
    })) as any

    await expect(
      fetchExternalImage('https://example.com/image.png', true, 1024, 0)
    ).rejects.toMatchObject({
      statusCode: 508,
      message: '"url" parameter is valid but upstream response is invalid',
    })
  })

  it('rejects when upstream response exceeds configured maximum body size', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        ETag: 'etag',
      }),
      body: createBody(['abcdef']),
    })) as any

    await expect(
      fetchExternalImage('https://example.com/image.png', true, 4)
    ).rejects.toMatchObject({
      statusCode: 413,
      message: '"url" parameter is valid but upstream response is invalid',
    })
  })

  it('returns upstream image metadata on success', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: createHeaders({
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        ETag: 'etag-1',
      }),
      body: createBody(['abc', 'def']),
    })) as any

    const result = await fetchExternalImage(
      'https://example.com/image.png',
      true,
      1024
    )

    expect(result.contentType).toBe('image/png')
    expect(result.cacheControl).toBe('public, max-age=60')
    expect(result.buffer).toEqual(Buffer.from('abcdef'))
    expect(result.etag).toBe(Buffer.from('etag-1').toString('base64url'))
  })

  it('blocks private IP upstreams when local IPs are not allowed', async () => {
    await expect(
      fetchExternalImage('http://127.0.0.1/image.png', false, 1024)
    ).rejects.toMatchObject({
      statusCode: 400,
      message: '"url" parameter is not allowed',
    })
  })
})

describe('fetchInternalImage', () => {
  it('coerces HEAD to GET and returns successful internal response', async () => {
    const req = { method: 'HEAD', socket: {} } as any
    const res = {} as any
    let capturedMethod: string | undefined

    const result = await fetchInternalImage(
      '/_next/static/media/a.png',
      req,
      res,
      async (newReq, newRes) => {
        capturedMethod = newReq.method
        newRes.statusCode = 200
        newRes.setHeader('Content-Type', 'image/png')
        newRes.setHeader('Cache-Control', 'public, max-age=60')
        newRes.setHeader('ETag', 'etag-x')
        newRes.write('abc')
        newRes.end()
      }
    )

    expect(capturedMethod).toBe('GET')
    expect(result.contentType).toBe('image/png')
    expect(result.cacheControl).toBe('public, max-age=60')
    expect(result.buffer).toEqual(Buffer.from('abc'))
  })

  it('returns 500 image error on internal handler failure', async () => {
    const req = { method: 'GET', socket: {} } as any
    const res = {} as any

    await expect(
      fetchInternalImage('/_next/static/media/a.png', req, res, async () => {
        throw new Error('boom')
      })
    ).rejects.toMatchObject({
      statusCode: 500,
      message: '"url" parameter is valid but upstream response is invalid',
    })
  })

  it('returns 500 image error when internal handler never sets statusCode', async () => {
    const req = { method: undefined, socket: {} } as any
    const res = {} as any

    await expect(
      fetchInternalImage(
        '/_next/static/media/no-status.png',
        req,
        res,
        async (_newReq, newRes) => {
          newRes.statusCode = 0
          newRes.write('abc')
          newRes.end()
        }
      )
    ).rejects.toMatchObject({
      statusCode: 500,
      message: '"url" parameter is valid but upstream response is invalid',
    })
  })
})

describe('ImageOptimizerCache custom cache handler', () => {
  it('returns null on cache miss, wrong kind, and cache handler failure', async () => {
    const cacheHandler = {
      get: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          value: { kind: 'PAGE' },
          lastModified: Date.now(),
        })
        .mockRejectedValueOnce(new Error('handler failure')),
      set: jest.fn(),
    }

    const cache = new ImageOptimizerCache({
      distDir: process.cwd(),
      nextConfig: createNextConfig(),
      cacheHandler: cacheHandler as any,
    })

    await expect(cache.get('k1')).resolves.toBeNull()
    await expect(cache.get('k2')).resolves.toBeNull()
    await expect(cache.get('k3')).resolves.toBeNull()
  })

  it('computes stale and fallback revalidate values from cache metadata', async () => {
    const cacheHandler = {
      get: jest.fn().mockResolvedValue({
        value: {
          kind: 'IMAGE',
          buffer: Buffer.from('cached'),
          etag: 'etag',
          upstreamEtag: 'up-etag',
          extension: 'png',
          revalidate: 'invalid',
        },
        lastModified: Date.now() - 70_000,
      }),
      set: jest.fn(),
    }

    const cache = new ImageOptimizerCache({
      distDir: process.cwd(),
      nextConfig: createNextConfig({ images: { minimumCacheTTL: 60 } }),
      cacheHandler: cacheHandler as any,
    })

    const entry = await cache.get('k1')
    expect(entry).not.toBeNull()
    expect(entry?.isStale).toBe(true)
    expect(entry?.cacheControl?.revalidate).toBe(60)
  })

  it('throws for invalid set payloads and applies minimum TTL for valid image sets', async () => {
    const cacheHandler = {
      get: jest.fn(),
      set: jest.fn(),
    }

    const cache = new ImageOptimizerCache({
      distDir: process.cwd(),
      nextConfig: createNextConfig({ images: { minimumCacheTTL: 60 } }),
      cacheHandler: cacheHandler as any,
    })

    await expect(
      cache.set('bad-kind', { kind: 'PAGE' } as any, {
        cacheControl: { revalidate: 10, expire: undefined },
      })
    ).rejects.toThrow('invariant attempted to set non-image to image-cache')

    await expect(
      cache.set(
        'bad-revalidate',
        {
          kind: 'IMAGE',
          buffer: Buffer.from('x'),
          etag: 'e',
          upstreamEtag: 'u',
          extension: 'png',
        } as any,
        {
          cacheControl: {} as any,
        }
      )
    ).rejects.toThrow('revalidate must be a number for image-cache')

    await expect(
      cache.set(
        'good',
        {
          kind: 'IMAGE',
          buffer: Buffer.from('x'),
          etag: 'e',
          upstreamEtag: 'u',
          extension: 'png',
        } as any,
        {
          cacheControl: { revalidate: 1, expire: 123 },
        }
      )
    ).resolves.toBeUndefined()

    expect(cacheHandler.set).toHaveBeenCalledWith(
      'good',
      expect.objectContaining({ revalidate: 60 }),
      {
        cacheControl: {
          revalidate: 60,
          expire: 123,
        },
      }
    )
  })

  it('swallows cache handler write failures', async () => {
    const cacheHandler = {
      get: jest.fn(),
      set: jest.fn().mockRejectedValue(new Error('write failed')),
    }

    const cache = new ImageOptimizerCache({
      distDir: process.cwd(),
      nextConfig: createNextConfig({ images: { minimumCacheTTL: 60 } }),
      cacheHandler: cacheHandler as any,
    })

    await expect(
      cache.set(
        'good',
        {
          kind: 'IMAGE',
          buffer: Buffer.from('x'),
          etag: 'e',
          upstreamEtag: 'u',
          extension: 'png',
        } as any,
        {
          cacheControl: { revalidate: 10, expire: undefined },
        }
      )
    ).resolves.toBeUndefined()
  })
})

describe('imageOptimizer', () => {
  it('returns the upstream image for animated and bypassed image types', async () => {
    mockIsAnimated.mockReturnValue(true)

    const animatedResult = await imageOptimizer(
      {
        buffer: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
        contentType: null,
        cacheControl: 'public, max-age=120',
        etag: 'upstream-etag',
      },
      {
        href: 'https://example.com/anim.gif',
        width: 16,
        quality: 75,
        mimeType: 'image/png',
      },
      createNextConfig(),
      { isDev: false }
    )

    expect(animatedResult.buffer).toEqual(
      Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    )
    expect(animatedResult.contentType).toBe('image/gif')
    expect(animatedResult.etag).toBe('upstream-etag')
    expect(animatedResult.upstreamEtag).toBe('upstream-etag')

    mockIsAnimated.mockReturnValue(false)

    const bypassedResult = await imageOptimizer(
      {
        buffer: Buffer.from([0x42, 0x4d, 0x00, 0x00]),
        contentType: null,
        cacheControl: 'public, max-age=120',
        etag: 'bmp-etag',
      },
      {
        href: 'https://example.com/image.bmp',
        width: 16,
        quality: 75,
        mimeType: 'image/png',
      },
      createNextConfig(),
      { isDev: false }
    )

    expect(bypassedResult.buffer).toEqual(Buffer.from([0x42, 0x4d, 0x00, 0x00]))
    expect(bypassedResult.contentType).toBe('image/bmp')
    expect(bypassedResult.etag).toBe('bmp-etag')
  })

  it('rejects invalid and disallowed upstream images', async () => {
    await expect(
      imageOptimizer(
        {
          buffer: Buffer.from('not-an-image'),
          contentType: null,
          cacheControl: null,
          etag: 'etag',
        },
        {
          href: 'https://example.com/image.txt',
          width: 16,
          quality: 75,
          mimeType: 'image/png',
        },
        createNextConfig(),
        { isDev: false }
      )
    ).rejects.toThrow("The requested resource isn't a valid image.")

    await expect(
      imageOptimizer(
        {
          buffer: Buffer.from('<svg></svg>'),
          contentType: null,
          cacheControl: null,
          etag: 'etag',
        },
        {
          href: 'https://example.com/image.svg',
          width: 16,
          quality: 75,
          mimeType: 'image/png',
        },
        createNextConfig(),
        { isDev: false }
      )
    ).rejects.toThrow('"url" parameter is valid but image type is not allowed')
  })

  it('returns the previously cached image without re-optimizing', async () => {
    const previousCacheEntry = {
      value: {
        kind: 'IMAGE',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        etag: 'cached-etag',
        upstreamEtag: 'upstream-etag',
        extension: 'png',
      },
      cacheControl: { revalidate: 240 },
    } as any

    const cachedResult = await imageOptimizer(
      {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: null,
        cacheControl: 'public, max-age=240',
        etag: 'upstream-etag',
      },
      {
        href: '/_next/static/media/cached.png',
        width: 16,
        quality: 75,
        mimeType: 'image/png',
      },
      createNextConfig(),
      { isDev: false, previousCacheEntry }
    )

    expect(cachedResult.buffer).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(cachedResult.contentType).toBe('image/png')
    expect(cachedResult.etag).toBe('cached-etag')
    expect(cachedResult.upstreamEtag).toBe('upstream-etag')
    expect(cachedResult.maxAge).toBe(240)
  })

  it('optimizes supported images through the sharp pipeline', async () => {
    const sourceImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2l0ZYAAAAASUVORK5CYII=',
      'base64'
    )

    const result = await optimizeImage({
      buffer: sourceImage,
      contentType: 'image/png',
      quality: 75,
      width: 16,
    })

    expect(Buffer.isBuffer(result)).toBe(true)
    expect(result.byteLength).toBeGreaterThan(0)
  })

  it('covers optimizeImage codec/resize branches (avif/webp/jpeg + height)', async () => {
    const sourceImage = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2l0ZYAAAAASUVORK5CYII=',
      'base64'
    )

    await expect(
      optimizeImage({
        buffer: sourceImage,
        contentType: 'image/avif',
        quality: 75,
        width: 16,
      })
    ).resolves.toBeInstanceOf(Buffer)

    await expect(
      optimizeImage({
        buffer: sourceImage,
        contentType: 'image/webp',
        quality: 75,
        width: 16,
      })
    ).resolves.toBeInstanceOf(Buffer)

    await expect(
      optimizeImage({
        buffer: sourceImage,
        contentType: 'image/jpeg',
        quality: 75,
        width: 16,
        height: 16,
      })
    ).resolves.toBeInstanceOf(Buffer)
  })

  it('creates blur svg placeholder in dev mode for blur boundary request', async () => {
    const oneByOnePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2l0ZYAAAAASUVORK5CYII=',
      'base64'
    )
    mockTransformer.toBuffer.mockResolvedValueOnce(oneByOnePng)

    const result = await imageOptimizer(
      {
        buffer: oneByOnePng,
        contentType: 'image/png',
        cacheControl: 'public, max-age=120',
        etag: 'upstream-etag',
      },
      {
        href: '/_next/static/media/blur.png',
        width: 8,
        quality: 70,
        mimeType: 'image/png',
      },
      createNextConfig(),
      { isDev: true }
    )

    expect(result.contentType).toBe('image/svg+xml')
    expect(result.buffer.toString()).toContain('<svg')
  })
})

describe('sendResponse', () => {
  it('sends body for GET requests and applies image headers', () => {
    const req = { method: 'GET', headers: {} } as any
    const { res, headers, getEndedWith } = createMockServerResponse()

    sendResponse(
      req,
      res,
      '/_next/static/media/pic.png',
      'png',
      Buffer.from('hello'),
      'etag-123',
      false,
      'MISS',
      createNextConfig().images,
      60,
      false
    )

    expect(headers.get('content-type')).toBe('image/png')
    expect(headers.get('x-nextjs-cache')).toBe('MISS')
    expect(headers.get('content-length')).toBe(5)
    expect(getEndedWith()).toEqual(Buffer.from('hello'))
  })

  it('ends without body for HEAD requests and supports weak content typing fallback', () => {
    const req = { method: 'HEAD', headers: {} } as any
    const { res, headers, getEndedWith } = createMockServerResponse()

    sendResponse(
      req,
      res,
      '/foo/noext',
      'unknown-extension',
      Buffer.from('ignored'),
      'etag-456',
      true,
      'HIT',
      createNextConfig().images,
      600,
      false
    )

    expect(headers.get('cache-control')).toContain('immutable')
    expect(headers.get('content-type')).toBe('application/octet-stream')
    expect(getEndedWith()).toBeUndefined()
  })

  it('returns early with 304 when etag is fresh', () => {
    const req = {
      method: 'GET',
      headers: {
        'if-none-match': 'etag-fresh',
      },
    } as any
    const { res, headers, getEndedWith } = createMockServerResponse()

    sendResponse(
      req,
      res,
      '/_next/static/media/fresh.png',
      'png',
      Buffer.from('body'),
      'etag-fresh',
      false,
      'STALE',
      createNextConfig().images,
      60,
      false
    )

    expect(res.statusCode).toBe(304)
    expect(headers.get('content-length')).toBeUndefined()
    expect(getEndedWith()).toBeUndefined()
  })
})

describe('ImageOptimizerCache filesystem path', () => {
  it('reads/writes image entries when filesystem cache is enabled', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'next-image-cache-')
    )
    try {
      const cache = new ImageOptimizerCache({
        distDir: tempDir,
        nextConfig: createNextConfig({
          images: {
            minimumCacheTTL: 60,
            maximumDiskCacheSize: 1024 * 1024,
          },
          experimental: {
            isrFlushToDisk: true,
          },
        }),
      })

      await cache.set(
        'file-key',
        {
          kind: 'IMAGE',
          buffer: Buffer.from('file-image'),
          etag: 'etag',
          upstreamEtag: 'up-etag',
          extension: 'png',
        } as any,
        {
          cacheControl: {
            revalidate: 60,
            expire: undefined,
          },
        }
      )

      const entry = await cache.get('file-key')
      expect(entry).not.toBeNull()
      expect(entry?.value).toMatchObject({
        kind: 'IMAGE',
        etag: 'etag',
        upstreamEtag: 'up-etag',
        extension: 'png',
      })
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})

describe('second pass: uncommon fallback branches', () => {
  it.each([
    ['avif', 'image/avif'],
    ['webp', 'image/webp'],
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['gif', 'image/gif'],
    ['svg', 'image/svg+xml'],
    ['jxl', 'image/jxl'],
    ['jxl-stream', 'image/jxl'],
    ['jp2', 'image/jp2'],
    ['tiff', 'image/tiff'],
    ['tif', 'image/tiff'],
    ['pdf', 'application/pdf'],
    ['bmp', 'image/bmp'],
    ['ico', 'image/x-icon'],
    ['icns', 'image/x-icns'],
  ])(
    'maps detector format %s through switch branch',
    async (format, expected) => {
      mockDetector.mockReturnValueOnce(format)
      await expect(
        detectContentType(Buffer.from('unknown-bits'), true)
      ).resolves.toBe(expected)
    }
  )

  it('returns null for unsupported detector format branch', async () => {
    mockDetector.mockReturnValueOnce('raw')
    await expect(
      detectContentType(Buffer.from('unknown-bits'), true)
    ).resolves.toBeNull()
  })

  it('uses metadata fallback branch when detector is empty', async () => {
    mockDetector.mockReturnValueOnce(undefined)
    ;(mockTransformer as any).metadata = jest.fn(async () => ({
      format: 'png',
    }))

    await expect(
      detectContentType(Buffer.from('mystery'), false)
    ).resolves.toBe('image/png')
  })

  it('covers metadata fallback catch branch', async () => {
    mockDetector.mockReturnValueOnce(undefined)
    ;(mockTransformer as any).metadata = jest.fn(async () => {
      throw new Error('metadata crash')
    })

    await expect(
      detectContentType(Buffer.from('mystery'), false)
    ).resolves.toBeNull()
  })

  it('covers external fetch branch with empty body', async () => {
    const originalFetch = global.fetch
    try {
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: createHeaders({}),
        body: null,
      })) as any

      await expect(
        fetchExternalImage('https://example.com/empty.png', true, 1024)
      ).rejects.toMatchObject({ statusCode: 400 })
    } finally {
      global.fetch = originalFetch
    }
  })

  it('covers non-timeout network error rethrow branch', async () => {
    const originalFetch = global.fetch
    try {
      global.fetch = jest.fn(async () => {
        const err = new Error('socket hang up')
        ;(err as any).name = 'NetworkError'
        throw err
      }) as any

      await expect(
        fetchExternalImage('https://example.com/net-fail.png', true, 1024)
      ).rejects.toThrow('socket hang up')
    } finally {
      global.fetch = originalFetch
    }
  })

  it('falls back to upstream image when optimizeImage fails mid-transform', async () => {
    const error = new Error('transform fail')
    mockTransformer.toBuffer.mockRejectedValueOnce(error)

    const result = await imageOptimizer(
      {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        contentType: null,
        cacheControl: 'public, max-age=120',
        etag: 'upstream-etag',
      },
      {
        href: 'https://example.com/chameleon.png',
        width: 16,
        quality: 75,
        mimeType: 'image/avif',
      },
      createNextConfig(),
      { isDev: false }
    )

    expect(result.contentType).toBe('image/png')
    expect(result.etag).toBe('upstream-etag')
    expect(result.error).toBeDefined()
  })

  it('covers DNS lookup variants (mixed IPv4/IPv6 + lookup rejection fallback)', async () => {
    const originalFetch = global.fetch
    try {
      jest.resetModules()
      jest.doMock('dns/promises', () => ({
        lookup: jest.fn(async () => [
          { address: '8.8.8.8' },
          { address: '2606:4700:4700::1111' },
        ]),
      }))

      const { fetchExternalImage: isolatedFetch1 } =
        require('./image-optimizer') as typeof import('./image-optimizer')

      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        headers: createHeaders({
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
          ETag: 'etag-v',
        }),
        body: createBody(['ok']),
      })) as any

      await expect(
        isolatedFetch1('https://example.com/variant.png', false, 1024)
      ).resolves.toMatchObject({ contentType: 'image/png' })

      jest.dontMock('dns/promises')
      jest.resetModules()
      jest.doMock('dns/promises', () => ({
        lookup: jest.fn(async () => {
          throw new Error('ENOTFOUND')
        }),
      }))

      const { fetchExternalImage: isolatedFetch2 } =
        require('./image-optimizer') as typeof import('./image-optimizer')
      await expect(
        isolatedFetch2('https://not.real.tld/image.png', false, 1024)
      ).resolves.toMatchObject({ contentType: 'image/png' })
    } finally {
      global.fetch = originalFetch
      jest.dontMock('dns/promises')
      jest.resetModules()
    }
  })

  it('covers disk-lru full and corruption initialization branches', async () => {
    jest.resetModules()
    const mockReaddir = jest.fn(async (inputPath: string) => {
      if (inputPath.includes(path.join('cache', 'images'))) return ['bad-key']
      return ['broken-file']
    })

    jest.doMock('fs', () => ({
      promises: {
        readdir: mockReaddir,
        readFile: jest.fn(async () => {
          throw new Error('corrupt cache')
        }),
        rm: jest.fn(async () => {}),
        mkdir: jest.fn(async () => {}),
        writeFile: jest.fn(async () => {}),
      },
    }))

    jest.doMock('./lib/disk-lru-cache.external', () => ({
      getOrInitDiskLRU: jest.fn(
        async (
          cacheDir: string,
          _size: number,
          initEntries: (cacheDir: string) => Promise<any>
        ) => {
          await initEntries(cacheDir)
          return {
            get: jest.fn(),
            set: jest.fn(() => false),
          }
        }
      ),
    }))

    const { ImageOptimizerCache: IsolatedCache } =
      require('./image-optimizer') as typeof import('./image-optimizer')

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-image-lru-'))
    try {
      const cache = new IsolatedCache({
        distDir: tempDir,
        nextConfig: createNextConfig({
          images: {
            minimumCacheTTL: 60,
            maximumDiskCacheSize: 1024,
          },
          experimental: {
            isrFlushToDisk: true,
          },
        }),
      })

      await expect(
        cache.set(
          'lru-full',
          {
            kind: 'IMAGE',
            buffer: Buffer.from('x'),
            etag: 'e',
            upstreamEtag: 'u',
            extension: 'png',
          } as any,
          {
            cacheControl: { revalidate: 60, expire: undefined },
          }
        )
      ).resolves.toBeUndefined()
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
      jest.dontMock('fs')
      jest.dontMock('./lib/disk-lru-cache.external')
      jest.resetModules()
    }
  })
})
