import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import {
	getConversations,
	getMessages,
	markConversationRead,
	updateConversationStatus
} from '../chat/service'

const messagesQuery = t.Object({
	limit: t.Optional(t.Numeric()),
	before: t.Optional(t.Numeric())
})

const conversationsQuery = t.Object({
	limit: t.Optional(t.Numeric()),
	offset: t.Optional(t.Numeric())
})

export const conversationsRoutes = new Elysia()
	.get(
		'/admin/conversations',
		async ({ headers, query, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return getConversations(query)
		},
		{ query: conversationsQuery }
	)
	.post('/admin/conversations/:id/read', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		if (!(await markConversationRead(Number(params.id)))) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		return { ok: true }
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
