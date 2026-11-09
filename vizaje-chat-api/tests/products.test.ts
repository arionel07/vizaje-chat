import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { setProductSearchConfig, setProductSearchFetcher } from '../src/products/service'
import { api, makeAdmin, resetDb } from './helpers'

let adminToken: string

const SKU_5403 = {
	SKU: '5403',
	GUID: '5403',
	barcode: '3614270129681',
	variant_barcodes: '',
	titleRU: 'Biotherm Aquasource Total Eye Revitalizer Крем для кожи вокруг глаз',
	titleRO: 'Biotherm Aquasource Total Eye Revitalizer Cremă pentru conturul ochilor',
	brand: 'Biotherm',
	image: '76fac5afa3cc794d7fc5b0f9e6d8edde.jpg',
	uriRU: '5403',
	category_uriRU: 'uhod-za-kojey-vokrug-glaz',
	has_variants: false,
	variant_skus: '',
	has_stock: 1
}

let lastRequest: { url: string; body: unknown } | null = null

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setProductSearchConfig({ host: 'http://meili.test', searchKey: 'test-key', index: 'products' })
	setProductSearchFetcher(async (url, init) => {
		lastRequest = { url: String(url), body: JSON.parse(String(init?.body)) }
		return new Response(JSON.stringify({ hits: [SKU_5403] }), { status: 200 })
	})
})

beforeEach(() => {
	lastRequest = null
})

describe('GET /admin/products/search', () => {
	test('без токена → 401', async () => {
		const res = await api('/admin/products/search?q=5403')
		expect(res.status).toBe(401)
	})

	test('ищет по Meilisearch и собирает ссылку/картинку из полей документа', async () => {
		const res = await api('/admin/products/search?q=5403', { token: adminToken })
		expect(res.status).toBe(200)
		expect(res.body).toEqual([
			{
				sku: '5403',
				guid: '5403',
				barcode: '3614270129681',
				title: 'Biotherm Aquasource Total Eye Revitalizer Крем для кожи вокруг глаз',
				titleRo: 'Biotherm Aquasource Total Eye Revitalizer Cremă pentru conturul ochilor',
				brand: 'Biotherm',
				imageUrl: 'https://vizaje-nica.com/public/products/76fac5afa3cc794d7fc5b0f9e6d8edde.webp',
				url: 'https://vizaje-nica.com/ru/katalog/uhod-za-kojey-vokrug-glaz/5403',
				hasVariants: false,
				variantSkus: [],
				variantBarcodes: [],
				inStock: true
			}
		])
		expect(lastRequest?.url).toBe('http://meili.test/indexes/products/search')
		expect(lastRequest?.body).toMatchObject({ q: '5403' })
	})

	test('варианты — список через запятую в variant_skus/variant_barcodes', async () => {
		setProductSearchFetcher(async () => {
			return new Response(
				JSON.stringify({
					hits: [
						{
							...SKU_5403,
							has_variants: true,
							variant_skus: '5404, 5405',
							variant_barcodes: '3614270129682, 3614270129683'
						}
					]
				}),
				{ status: 200 }
			)
		})
		const res = await api('/admin/products/search?q=5403', { token: adminToken })
		expect(res.body[0]).toMatchObject({
			hasVariants: true,
			variantSkus: ['5404', '5405'],
			variantBarcodes: ['3614270129682', '3614270129683']
		})
		setProductSearchFetcher(async (url, init) => {
			lastRequest = { url: String(url), body: JSON.parse(String(init?.body)) }
			return new Response(JSON.stringify({ hits: [SKU_5403] }), { status: 200 })
		})
	})

	test('has_stock: 0 → inStock: false', async () => {
		setProductSearchFetcher(async () => {
			return new Response(JSON.stringify({ hits: [{ ...SKU_5403, has_stock: 0 }] }), {
				status: 200
			})
		})
		const res = await api('/admin/products/search?q=5403', { token: adminToken })
		expect(res.body[0]).toMatchObject({ inStock: false })
		setProductSearchFetcher(async (url, init) => {
			lastRequest = { url: String(url), body: JSON.parse(String(init?.body)) }
			return new Response(JSON.stringify({ hits: [SKU_5403] }), { status: 200 })
		})
	})

	test('пустой запрос → пустой список, Meilisearch не дёргаем', async () => {
		const res = await api('/admin/products/search?q=', { token: adminToken })
		expect(res.status).toBe(200)
		expect(res.body).toEqual([])
		expect(lastRequest).toBeNull()
	})

	test('Meilisearch не настроен → 503', async () => {
		setProductSearchConfig({ host: null })
		const res = await api('/admin/products/search?q=5403', { token: adminToken })
		expect(res.status).toBe(503)
		setProductSearchConfig({ host: 'http://meili.test' })
	})
})
