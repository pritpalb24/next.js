/* eslint-env jest */

import { BloomFilter } from '../shared/lib/bloom-filter'
import { createClientRouterFilter } from './create-client-router-filter'

function inflateFilter(exportedFilter: ReturnType<BloomFilter['export']>) {
  const filter = new BloomFilter(
    exportedFilter.numItems,
    exportedFilter.errorRate
  )
  filter.import(exportedFilter)
  return filter
}

describe('createClientRouterFilter', () => {
  it('includes static routes, dynamic route prefixes, and interception route prefixes', () => {
    const filters = createClientRouterFilter(
      ['/about', '/blog/[slug]', '/feed/(.)photo/[id]'],
      [{ source: '/legacy', destination: '/about', permanent: true }],
      0.01
    )

    const staticFilter = inflateFilter(filters.staticFilter)
    const dynamicFilter = inflateFilter(filters.dynamicFilter)

    expect(staticFilter.contains('/about')).toBe(true)
    expect(staticFilter.contains('/legacy')).toBe(true)
    expect(dynamicFilter.contains('/blog')).toBe(true)
    expect(dynamicFilter.contains('/feed/photo')).toBe(true)
  })

  it('handles dynamic routes without a static prefix', () => {
    const filters = createClientRouterFilter(
      ['/[slug]', '/blog/[slug]'],
      [],
      0.01
    )

    const dynamicFilter = inflateFilter(filters.dynamicFilter)

    expect(dynamicFilter.contains('/blog')).toBe(true)
  })

  it('skips dynamic redirects and tolerates malformed redirect patterns', () => {
    const filters = createClientRouterFilter(
      ['/docs/[slug]'],
      [
        { source: '/redirect/:slug', destination: '/docs', permanent: true },
        { source: '/broken/:slug(', destination: '/docs', permanent: true },
      ],
      0.01
    )

    const staticFilter = inflateFilter(filters.staticFilter)
    const dynamicFilter = inflateFilter(filters.dynamicFilter)

    expect(staticFilter.contains('/docs')).toBe(false)
    expect(staticFilter.contains('/redirect')).toBe(false)
    expect(dynamicFilter.contains('/docs')).toBe(true)
  })

  it('normalizes trailing slash for static redirect sources', () => {
    const filters = createClientRouterFilter(
      ['/target'],
      [{ source: '/promo/', destination: '/target', permanent: false }],
      0.01
    )

    const staticFilter = inflateFilter(filters.staticFilter)

    expect(staticFilter.contains('/promo')).toBe(true)
    expect(staticFilter.contains('/promo/')).toBe(false)
  })
})
