import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { getOperatorsStats, getOverview, getTimeline, resolveRange } from '../analytics/service'

const rangeQuery = t.Object({
	from: t.Optional(t.String()),
	to: t.Optional(t.String())
})

const timelineQuery = t.Object({
	from: t.Optional(t.String()),
	to: t.Optional(t.String()),
	// на будущее: пока поддерживается только группировка по дням
	granularity: t.Optional(t.Literal('day'))
})

export const analyticsRoutes = new Elysia()
	.get(
		'/admin/analytics/overview',
		async ({ headers, query, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				return await getOverview(resolveRange(query.from, query.to))
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid range' }
			}
		},
		{ query: rangeQuery }
	)
	.get(
		'/admin/analytics/timeline',
		async ({ headers, query, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				return await getTimeline(resolveRange(query.from, query.to))
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid range' }
			}
		},
		{ query: timelineQuery }
	)
	.get(
		'/admin/analytics/operators',
		async ({ headers, query, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				return await getOperatorsStats(resolveRange(query.from, query.to))
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid range' }
			}
		},
		{ query: rangeQuery }
	)
