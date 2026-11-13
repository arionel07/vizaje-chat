import { Elysia } from 'elysia'
import { getRecentAiHandoffs } from '../ai-bot/service'
import { verifyToken } from '../auth/guard'

export const aiBotRoutes = new Elysia().get('/admin/ai-bot/handoffs', async ({ headers, set }) => {
	const admin = verifyToken(headers.authorization)
	if (!admin) {
		set.status = 401
		return { error: 'Unauthorized' }
	}
	return getRecentAiHandoffs()
})
