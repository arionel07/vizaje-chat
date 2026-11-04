import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { isProductSearchConfigured, searchProducts } from '../products/service'

export const productsRoutes = new Elysia().get(
	'/admin/products/search',
	async ({ headers, query, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		if (!isProductSearchConfigured()) {
			set.status = 503
			return { error: 'Product search is not configured' }
		}
		const q = query.q.trim()
		if (!q) return []
		try {
			return await searchProducts(q)
		} catch (e) {
			console.error(e)
			set.status = 502
			return { error: 'Product search failed' }
		}
	},
	{ query: t.Object({ q: t.String() }) }
)
