import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { publishToAdmins, publishToConversation } from '../chat/events'
import {
	exportConversationText,
	getConversationCounts,
	getConversations,
	getMessages,
	getOperators,
	markConversationRead,
	operatorExists,
	updateConversationAssignee,
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
	unread: t.Optional(t.BooleanString()),
	assignee: t.Optional(t.Union([t.Literal('me'), t.Literal('unassigned')])),
	q: t.Optional(t.String())
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
			return getConversations({ ...query, meId: admin.sub })
		},
		{ query: conversationsQuery }
	)
	.get('/admin/conversations/counts', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getConversationCounts(admin.sub)
	})
	.get('/admin/operators', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getOperators()
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
	// вся история беседы текстовым файлом — кнопка «Скачать» в шапке чата
	.get('/admin/conversations/:id/export', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const conversationId = Number(params.id)
		const text = await exportConversationText(conversationId)
		if (!text) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		set.headers['content-type'] = 'text/plain; charset=utf-8'
		set.headers['content-disposition'] =
			`attachment; filename="conversation-${conversationId}.txt"`
		return text
	})
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
	.patch(
		'/admin/conversations/:id/assignee',
		async ({ headers, params, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			if (body.assigneeId != null && !(await operatorExists(body.assigneeId))) {
				set.status = 404
				return { error: 'Operator not found' }
			}
			const conversationId = Number(params.id)
			const updated = await updateConversationAssignee(
				conversationId,
				body.assigneeId
			)
			if (!updated) {
				set.status = 404
				return { error: 'Conversation not found' }
			}
			// системное сообщение уже публикуется updateConversationAssignee;
			// admin:global получит его и обновит список — отдельное событие не нужно
			return updated
		},
		{
			body: t.Object({
				assigneeId: t.Union([t.Number(), t.Null()])
			})
		}
	)
