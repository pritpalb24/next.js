/* eslint-env jest */
import { createClientRouterFilter } from 'next/dist/lib/create-client-router-filter'

import { BloomFilter } from 'next/dist/shared/lib/bloom-filter'

function rebuild(exported: ReturnType<BloomFilter['export']>) {
  const fil = new BloomFilter(exported.numItems, exported.errorRate)
  fil .import(exported)
  return fil 
}

describe('createClientRouterFilter -  mutation adequacy tests', () => {
  it('adds plain static paths to the static filter only by count', () => {
    const { staticFilter, dynamicFilter } = createClientRouterFilter(
      ['/about', '/contact', '/pricing'],
      []
    )
    expect(staticFilter.numItems).toBe(3)

    expect(dynamicFilter.numItems).toBe(0)
    const s = rebuild(staticFilter)

    expect(s.contains('/about')).toBe(true)

    expect(s.contains('/contact')).toBe(true)
    expect(s.contains('/pricing')).toBe(true)
  })

  it('adds extracted prefix of a dynamic route to dynamicFilter', () => {
    const { staticFilter, dynamicFilter } = createClientRouterFilter(
      ['/blog/[slug]'],
      []
    )
    expect(staticFilter.numItems).toBe(0)
    expect(dynamicFilter.numItems).toBe(1)
    const d = rebuild(dynamicFilter)
    expect(d.contains('/blog')).toBe(true)
  })

  it('stops extracting at the first dynamic segment multi level', () => {
    const { dynamicFilter } = createClientRouterFilter(
      ['/shop/products/[id]/reviews'],
      []
    )
    expect(dynamicFilter.numItems).toBe(1)
    const d = rebuild(dynamicFilter)
    expect(d.contains('/shop/products')).toBe(true)
  })

  it('does not add a prefix when the first segment is dynamic', () => {
    const { staticFilter, dynamicFilter } = createClientRouterFilter(
      ['/[lang]'],
      []
    )
    expect(staticFilter.numItems).toBe(0)
    expect(dynamicFilter.numItems).toBe(0)
  })

  it('handles several single level dynamic routes and dedupes prefixes via set semantics', () => {
    const { dynamicFilter } = createClientRouterFilter(
      ['/blog/[slug]', '/blog/[otherSlug]'],
      []
    )
    expect(dynamicFilter.numItems).toBe(1)
    const d = rebuild(dynamicFilter)
    expect(d.contains('/blog')).toBe(true)
  })

  it('extracts the intercepted route for interception app paths', () => {
    const { dynamicFilter } = createClientRouterFilter(
      ['/feed/(..)photo/[id]'],
      []
    )
    expect(dynamicFilter.numItems).toBe(1)
    const d = rebuild(dynamicFilter)
    expect(d.contains('/photo')).toBe(true)
  })

  it('includes a static redirect source in staticFilter', () => {
    const { staticFilter, dynamicFilter } = createClientRouterFilter(
      [],
      [
        {
          source: '/old-page',
          destination: '/new-page',
          permanent: true,
        },
      ]
    )
    expect(staticFilter.numItems).toBe(1)
    expect(dynamicFilter.numItems).toBe(0)
    const s = rebuild(staticFilter)
    expect(s.contains('/old-page')).toBe(true)
  })

  it('strips trailing slash before inserting redirect source', () => {
    const { staticFilter } = createClientRouterFilter(
      [],
      [
        {
          source: '/legacy/',
          destination: '/new',
          permanent: false,
        },
      ]
    )
    expect(staticFilter.numItems).toBe(1)
    const s = rebuild(staticFilter)
    expect(s.contains('/legacy')).toBe(true)
  })

  it('not include parameterized redirect sources in staticFilter', () => {
    const { staticFilter } = createClientRouterFilter(
      [],
      [
        {
          source: '/post/:slug',
          destination: '/blog/:slug',
          permanent: true,
        },
      ]
    )
    expect(staticFilter.numItems).toBe(0)
  })

  it('still includes a redirect whose tokens fail to parse caught error path', () => {
    const badSource = '/('
    const { staticFilter } = createClientRouterFilter(
      [],
      [
        {
          source: badSource,
          destination: '/x',
          permanent: false,
        },
      ]
    )
    expect(staticFilter.numItems).toBe(1)
    const s = rebuild(staticFilter)
    expect(s.contains('/(')).toBe(true)
  })

  it('handles the curPart startsWith  "[" branch distinctly from endsWith', () => {

    const { dynamicFilter } = createClientRouterFilter(
      ['/product/[id]'],
      []
    )
    expect(dynamicFilter.numItems).toBe(1)
    const d = rebuild(dynamicFilter)
    expect(d.contains('/product')).toBe(true)
  })

it('passes allowedErrorRate through to both filters', () => {
    const rate = 0.001
    const { staticFilter, dynamicFilter } = createClientRouterFilter(
      ['/a', '/b/[c]'],
      [],
      rate
    )
    expect(staticFilter.errorRate).toBe(rate)

    expect(dynamicFilter.errorRate).toBe(rate)
  })

  it('returns an object with both filter keys object literal check', () => {
    const result = createClientRouterFilter(
      ['/home', '/user/[id]'],
      [
        {
          source: '/old',
          destination: '/home',
          permanent: true,
        },
      ]
    )
    expect(Object.keys(result).sort()).toEqual([
      'dynamicFilter',
      'staticFilter',
    ])
    expect(result.staticFilter.numItems).toBe(2)

    expect(result.dynamicFilter.numItems).toBe(1)
  })

  it('produces an empty dynamic filter numItems 0 when only have static path', () => {
    const { dynamicFilter } = createClientRouterFilter(['/a', '/b'], [])
    expect(dynamicFilter.numItems).toBe(0)
  })
})
