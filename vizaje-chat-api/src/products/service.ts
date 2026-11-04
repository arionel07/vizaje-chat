import { MEILISEARCH_HOST, MEILISEARCH_INDEX, MEILISEARCH_SEARCH_KEY } from '../config'

// сайт легаси-проекта — URL товара и картинки строятся по его структуре
// (подтверждено вручную: /ru/katalog/<category_uriRU>/<uriRU>, картинки —
// /public/products/<имя файла без расширения>.webp, не то расширение,
// что в поле image индекса)
const SITE_BASE_URL = 'https://vizaje-nica.com'
const PRODUCT_IMAGE_BASE_URL = `${SITE_BASE_URL}/public/products/`

// документ в индексе vizaje_products_prod (легаси Meilisearch) — только
// поля, которые реально используем; остальные (цены, остатки, категория
// текстом и т.п.) индекс содержит, но карточке товара в чате не нужны
type MeiliProductHit = {
	SKU: string
	GUID: string
	barcode: string
	variant_barcodes: string
	titleRU: string
	titleRO: string
	brand: string
	image: string
	uriRU: string
	category_uriRU: string
	has_variants: boolean
	variant_skus: string
}

export type Product = {
	sku: string
	guid: string
	barcode: string | null
	title: string
	titleRo: string
	brand: string
	imageUrl: string | null
	url: string
	hasVariants: boolean
	variantSkus: string[]
	variantBarcodes: string[]
}

// запятая — разделитель в этих полях индекса (variant_skus/variant_barcodes
// хранятся плоской строкой, не JSON-массивом)
const splitList = (value: string) =>
	value
		.split(',')
		.map(v => v.trim())
		.filter(Boolean)

function toProduct(hit: MeiliProductHit): Product {
	const imageName = hit.image?.replace(/\.[^.]+$/, '')
	return {
		sku: hit.SKU,
		guid: hit.GUID,
		barcode: hit.barcode || null,
		title: hit.titleRU,
		titleRo: hit.titleRO,
		brand: hit.brand,
		imageUrl: imageName ? `${PRODUCT_IMAGE_BASE_URL}${imageName}.webp` : null,
		url: `${SITE_BASE_URL}/ru/katalog/${hit.category_uriRU}/${hit.uriRU}`,
		hasVariants: hit.has_variants,
		variantSkus: splitList(hit.variant_skus || ''),
		variantBarcodes: splitList(hit.variant_barcodes || '')
	}
}

// host/key/index — переменные, не константы: тесты подменяют их через
// setProductSearchConfig, чтобы не требовать настоящий Meilisearch (тот же
// приём, что setTelegramSender в telegram/service.ts — продовое значение
// берётся из config.ts при загрузке модуля, в тестах переопределяется)
let host = MEILISEARCH_HOST
let searchKey = MEILISEARCH_SEARCH_KEY
let index = MEILISEARCH_INDEX

export function setProductSearchConfig(
	overrides: Partial<{ host: string | null; searchKey: string | null; index: string | null }>
) {
	if ('host' in overrides) host = overrides.host ?? null
	if ('searchKey' in overrides) searchKey = overrides.searchKey ?? null
	if ('index' in overrides) index = overrides.index ?? null
}

export const isProductSearchConfigured = () => Boolean(host && searchKey && index)

// в тестах подменяется моком, чтобы не требовать настоящий Meilisearch —
// тот же приём, что setTelegramSender в telegram/service.ts. Своя узкая
// сигнатура вместо typeof fetch — у неё в Bun ещё и статический preconnect,
// который моку в тестах реализовывать незачем
type Fetcher = (url: string, init: RequestInit) => Promise<Response>
let fetcher: Fetcher = fetch
export function setProductSearchFetcher(fn: Fetcher) {
	fetcher = fn
}

const SEARCH_LIMIT = 20

export async function searchProducts(query: string): Promise<Product[]> {
	if (!host || !searchKey || !index) {
		throw new Error('Product search is not configured')
	}
	const res = await fetcher(`${host}/indexes/${index}/search`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${searchKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ q: query, limit: SEARCH_LIMIT })
	})
	if (!res.ok) {
		throw new Error(`Meilisearch search failed: ${res.status}`)
	}
	const data = (await res.json()) as { hits: MeiliProductHit[] }
	return data.hits.map(toProduct)
}
