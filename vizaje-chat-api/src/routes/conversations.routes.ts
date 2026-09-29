import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { publishToAdmins, publishToConversation } from '../chat/events'
import {
	getConversationCounts,
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
	offset: t.Optional(t.Numeric()),
	status: t.Optional(t.Union([t.Literal('open'), t.Literal('closed')])),
	unread: t.Optional(t.BooleanString())
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
	.get('/admin/conversations/counts', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getConversationCounts()
	})
	.post('/admin/conversations/:id/read', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const conversationId = Number(params.id)
		const at = await markConversationRead(conversationId)
		if (!at) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		// посетитель увидит «Прочитано», другие операторы обновят счётчики
		const event = {
			type: 'read',
			by: 'admin',
			conversationId,
			at: at.toISOString()
		}
		publishToConversation(conversationId, event)
		publishToAdmins(event)
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
