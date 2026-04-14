/* eslint-env jest */
import {
  getHash,
  extractEtag,
  getImageEtag,
  detectContentType,
  getMaxAge,
  ImageOptimizerCache,
} from 'next/dist/server/image-optimizer'

function mkReq(accept = 'image/webp,*/*;q=0.8'): any {
  return { headers: { accept } }
}

function mkConfig(overrides: any = {}): any {
  return {
    images: {
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
      domains: [],
      remotePatterns: [],
      localPatterns: undefined,
      qualities: undefined,
      minimumCacheTTL: 60,
      formats: ['image/webp'],
      ...(overrides.images || {}),
    },
    basePath: overrides.basePath || '',
  }
}

describe('image-optimizer -  mutation adequacy tests', () => {
  describe('getHash', () => {
    it('produces a stable url-safe base64 hash', () => {
      const h = getHash(['hello'])

      expect(typeof h).toBe('string')
      expect(h).not.toMatch(/[+/=]/)
    })

    it('hashes different inputs to different outputs', () => {
      expect(getHash(['a'])).not.toBe(getHash(['b']))
    })

    it('treats number and string of number the same', () => {
      expect(getHash([1])).toBe(getHash(['1']))
    })

    it('incorporates buffer contents', () => {
      expect(getHash([Buffer.from('abc')])).not.toBe(
        getHash([Buffer.from('abd')])
      )
    })

    it('order of items affects the digest', () => {
      expect(getHash(['a', 'b'])).not.toBe(getHash(['b', 'a']))
    })
  })

  describe('extractEtag / getImageEtag', () => {
    it('base64url encodes an upstream etag when provided', () => {
      const res = extractEtag('"abc/123+="', Buffer.from('img'))

      expect(res).toBe(Buffer.from('"abc/123+="').toString('base64url'))
    })

    it('falls back to hash of image when no etag is provided', () => {
      const buf = Buffer.from('image-bytes')
      expect(extractEtag(undefined, buf)).toBe(getImageEtag(buf))
      expect(extractEtag(null, buf)).toBe(getImageEtag(buf))

      expect(extractEtag('', buf)).toBe(getImageEtag(buf))
    })

    it('getImageEtag is stable for the same buffer', () => {
      const b1 = Buffer.from('x')
      const b2 = Buffer.from('x')
      expect(getImageEtag(b1)).toBe(getImageEtag(b2))
    })
  })

  describe('getMaxAge', () => {
    it('returns 0 when header is missing', () => {
      expect(getMaxAge(null)).toBe(0)
      expect(getMaxAge(undefined)).toBe(0)
      expect(getMaxAge('')).toBe(0)
    })

    it('parses s-maxage preferentially over max-age', () => {
      expect(getMaxAge('s-maxage=120, max-age=30')).toBe(120)
    })

    it('parses max-age when s-maxage is absent', () => {
      expect(getMaxAge('max-age=45, public')).toBe(45)
    })

    it('strips surrounding quotes from the age value', () => {
      expect(getMaxAge('max-age="60"')).toBe(60)
    })

    it('returns 0 when the value is not a parseable integer', () => {
      expect(getMaxAge('max-age=abc')).toBe(0)
    })
  })

  describe('detectContentType — magic numbers for all supported formats', () => {
    const TESTS: Array<[string, number[], string]> = [
      [
        'JPEG',
        [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46],
        'image/jpeg',
      ],
      [
        'PNG',
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00],
        'image/png',
      ],
      ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0], 'image/gif'],
      [
        'WEBP',
        [
          0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42,
          0x50,
        ],
        'image/webp',
      ],
      [
        'SVG xml declaration',
        [0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20],
        'image/svg+xml',
      ],

      [
        'SVG bare svg',
        [0x3c, 0x73, 0x76, 0x67, 0x20, 0x78],
        'image/svg+xml',
      ],
      [
        'AVIF',
        [
          0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69,
          0x66,
        ],
        'image/avif',
      ],
      ['ICO', [0x00, 0x00, 0x01, 0x00, 0x01], 'image/x-icon'],
      [
        'ICNS',
        [0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10],
        'image/x-icns',
      ],
      ['TIFF', [0x49, 0x49, 0x2a, 0x00, 0x08], 'image/tiff'],
      ['BMP', [0x42, 0x4d, 0x10, 0x00], 'image/bmp'],
      ['JXL short', [0xff, 0x0a, 0x00], 'image/jxl'],
      [
        'JXL container',
        [
          0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87,
          0x0a,
        ],
        'image/jxl',
      ],
      [
        'HEIC',
        [
          0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69,
          0x63,
        ],
        'image/heic',
      ],
      ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e], 'application/pdf'],
      [
        'JP2',
        [
          0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87,
          0x0a,
        ],
        'image/jp2',
      ],
    ]

    it.each(TESTS)('detects %s', async (_name, bytes, expected) => {
      const buf = Buffer.from(bytes)
      await expect(
        detectContentType(buf, true)
      ).resolves.toBe(expected)
    })

    it('returns null for an empty buffer', async () => {
      await expect(detectContentType(Buffer.alloc(0), true)).resolves.toBe(null)
    })

    it('returns null for unknown bytes with skipMetadata=true', async () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04])
      await expect(detectContentType(buf, true)).resolves.toBe(null)
    })
  })

  describe('ImageOptimizerCache.validateParams — request validation branches', () => {
    it('errors when url is missing', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        {},
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is required')
    })

    it('errors when url is an array', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: ['/a', '/b'] as any, w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter cannot be an array')
    })

    it('errors when url exceeds 3072 characters', () => {
      const longUrl = '/' + 'a'.repeat(3072)
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: longUrl, w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is too long')
    })

    it('errors for protocol-relative urls', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '//example.com/a.jpg', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe(
        '"url" parameter cannot be a protocol-relative URL (//)'
      )
    })

    it('errors when a local url points at a recursive /_next/image endpoint', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/_next/image?url=/other.jpg', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter cannot be recursive')
    })

    it('errors when a local url is not allowed by localPatterns', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/private.jpg', w: '128', q: '75' },
        mkConfig({ images: { localPatterns: [{ pathname: '/public/*' }] } }),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is not allowed')
    })

    it('errors when an absolute url is not a valid URL', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: 'not a url', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is invalid')
    })

    it('errors when an absolute url has a non-http(s) protocol', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        {
          url: 'ftp://example.com/a.jpg',
          w: '128',
          q: '75',
        },
        mkConfig({ images: { remotePatterns: [{ hostname: '**' }] } }),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is invalid')
    })

    it('errors when an absolute url is not allowed by remotePatterns', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        {
          url: 'https://evil.example/a.jpg',
          w: '128',
          q: '75',
        },
        mkConfig({
          images: { remotePatterns: [{ hostname: 'good.example' }] },
        }),
        false
      ) as any
      expect(r.errorMessage).toBe('"url" parameter is not allowed')
    })

    it('errors when w is missing', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"w" parameter (width) is required')
    })

    it('errors when w is an array', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: ['1', '2'] as any, q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"w" parameter (width) cannot be an array')
    })

    it('errors when w is non-numeric', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '12a', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe(
        '"w" parameter (width) must be an integer greater than 0'
      )
    })

    it('errors when q is missing', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"q" parameter (quality) is required')
    })

    it('errors when q is an array', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: ['1', '2'] as any },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe(
        '"q" parameter (quality) cannot be an array'
      )
    })

    it('errors when q is non-numeric', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: '1x' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe(
        '"q" parameter (quality) must be an integer between 1 and 100'
      )
    })

    it('errors when w resolves to zero', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '0', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe(
        '"w" parameter (width) must be an integer greater than 0'
      )
    })

    it('errors when width is not in the configured sizes list', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '999', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBe('"w" parameter (width) of 999 is not allowed')
    })

    it('errors when quality is out of 1 to 100 range', () => {
      const r1 = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: '0' },
        mkConfig(),
        false
      ) as any
      expect(r1.errorMessage).toBe(
        '"q" parameter (quality) must be an integer between 1 and 100'
      )
      const r2 = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: '101' },
        mkConfig(),
        false
      ) as any
      expect(r2.errorMessage).toBe(
        '"q" parameter (quality) must be an integer between 1 and 100'
      )
    })

    it('errors when qualities are configured and the requested quality is not allowed', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: '70' },
        mkConfig({ images: { qualities: [50, 75] } }),
        false
      ) as any
      expect(r.errorMessage).toBe('"q" parameter (quality) of 70 is not allowed')
    })

    it('succeeds and returns ImageParamsResult for a valid local url', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.errorMessage).toBeUndefined()
      expect(r.href).toBe('/a.jpg')
      expect(r.isAbsolute).toBe(false)
      expect(r.isStatic).toBe(false)
      expect(r.width).toBe(128)
      expect(r.quality).toBe(75)
      expect(r.minimumCacheTTL).toBe(60)
      expect(Array.isArray(r.sizes)).toBe(true)
      expect(r.sizes).toContain(128)
    })

    it('marks as static when url starts with /_next/static/media with no basePath', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/_next/static/media/logo.png', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.isStatic).toBe(true)
    })

    it('honors basePath when detecting isStatic', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/app/_next/static/media/logo.png', w: '128', q: '75' },
        mkConfig({ basePath: '/app' }),
        false
      ) as any
      expect(r.isStatic).toBe(true)
    })

    it('negotiates mimeType from the accept header against configured formats', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq('image/avif,image/webp,*/*;q=0.8'),
        { url: '/a.jpg', w: '128', q: '75' },
        mkConfig({ images: { formats: ['image/avif', 'image/webp'] } }),
        false
      ) as any
      expect(r.mimeType).toBe('image/avif')
    })

    it('returns empty mimeType when accept header does not match any configured format', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq('text/html'),
        { url: '/a.jpg', w: '128', q: '75' },
        mkConfig(),
        false
      ) as any
      expect(r.mimeType).toBe('')
    })

    it('allows the dev blur width <= BLUR_IMG_SIZE in dev mode', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        { url: '/a.jpg', w: '8', q: '75' },
        mkConfig(),
        true
      ) as any
      expect(r.errorMessage).toBeUndefined()
      expect(r.width).toBe(8)
    })

    it('resolves absolute urls via URL when the hostname is allowed', () => {
      const r = ImageOptimizerCache.validateParams(
        mkReq(),
        {
          url: 'https://good.example/img.jpg',
          w: '128',
          q: '75',
        },
        mkConfig({
          images: { remotePatterns: [{ hostname: 'good.example' }] },
        }),
        false
      ) as any
      expect(r.errorMessage).toBeUndefined()
      expect(r.isAbsolute).toBe(true)
      expect(r.href).toBe('https://good.example/img.jpg')
    })
  })

  describe('ImageOptimizerCache.getCacheKey', () => {

    it('produces the same hash for the same inputs', () => {
      const a = ImageOptimizerCache.getCacheKey({
        href: '/a.jpg',
        width: 128,
        quality: 75,
        mimeType: 'image/webp',
      })
      const b = ImageOptimizerCache.getCacheKey({
        href: '/a.jpg',
        width: 128,
        quality: 75,
        mimeType: 'image/webp',
      })
      expect(a).toBe(b)
    })
    it('produces a different hash when any input changes', () => {
      const base = {
        href: '/a.jpg',
        width: 128,
        quality: 75,
        mimeType: 'image/webp',
      }
      const k = ImageOptimizerCache.getCacheKey(base)
      expect(k).not.toBe(
        ImageOptimizerCache.getCacheKey({ ...base, href: '/b.jpg' })
      )
      expect(k).not.toBe(
        ImageOptimizerCache.getCacheKey({ ...base, width: 256 })
      )
      expect(k).not.toBe(
        ImageOptimizerCache.getCacheKey({ ...base, quality: 50 })
      )
      expect(k).not.toBe(
        ImageOptimizerCache.getCacheKey({ ...base, mimeType: 'image/avif' })
      )
    })
  })
})
