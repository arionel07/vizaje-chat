import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import {
	getConversations,
	getMessages,
	updateConversationStatus
} from '../chat/service'

const messagesQuery = t.Object({
	limit: t.Optional(t.Numeric()),
	before: t.Optional(t.Numeric())
})

export const conversationsRoutes = new Elysia()
	.get('/admin/conversations', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getConversations()
	})
	.get(
		'/admin/conversations/:id/messages',
		async ({ headers, params, query, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return getMessages(Number(params.id), query)
		},
		{ query: messagesQuery }
	)
	.patch(
		'/admin/conversations/:id/status',
		async ({ headers, params, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return updateConversationStatus(Number(params.id), body.status)
		},
		{
			body: t.Object({
				status: t.Union([t.Literal('open'), t.Literal('closed')])
			})
		}
	)
