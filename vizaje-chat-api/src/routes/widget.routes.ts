import { Elysia, t } from 'elysia'
import { getClientIp } from '../chat/client-ip'
import { publishMessage, publishToAdmins } from '../chat/events'
import {
	allowSessionCreate,
	allowVisitorMessage,
	allowVisitorRead
} from '../chat/rate-limit'
import {
	addMessage,
	exportConversationText,
	getAdminReadAt,
	getMessages,
	markVisitorRead,
	replyTargetExists
} from '../chat/service'
import {
	getSchedule,
	getStatus,
	getWidgetTheme,
	summarizeSchedule
} from '../settings/service'
import { createSession, verifySessionToken } from '../widget/service'

export const widgetRoutes = new Elysia()
	// публичный: посетитель ещё без сессии, когда только открывает чат
	.get('/widget/status', async () => {
		const schedule = await getSchedule()
		return { ...getStatus(schedule), scheduleSummary: summarizeSchedule(schedule) }
	})
	// публичная конфигурация виджета (пока только сезонная тема); без авторизации,
	// как и /widget/status — запрашивается при загрузке, до создания сессии
	.get('/widget/config', async () => {
		return { theme: await getWidgetTheme() }
	})
	.post('/widget/session', async ({ set, request, server }) => {
		if (!allowSessionCreate(getClientIp({ request, server }))) {
			set.status = 429
			return { error: 'Too many sessions, try again later' }
		}
		return createSession()
	})
	.post(
		'/widget/messages',
		async ({ headers, body, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			if (!allowVisitorMessage(session.conversationId)) {
				set.status = 429
				return { error: 'Too many messages' }
			}
			if (
				body.replyToId &&
				!(await replyTargetExists(session.conversationId, body.replyToId))
			) {
				set.status = 404
				return { error: 'Reply target not found' }
			}
			const msg = await addMessage(
				session.conversationId,
				'visitor',
				body.text,
				body.replyToId
			)
			publishMessage(session.conversationId, msg)
			return msg
		},
		{
			body: t.Object({
				text: t.String(),
				replyToId: t.Optional(t.Integer({ minimum: 1 }))
			})
		}
	)
	// посетитель увидел сообщения — оператор покажет «Прочитано»
	.post('/widget/read', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		if (!allowVisitorRead(session.conversationId)) {
			set.status = 429
			return { error: 'Too many requests' }
		}
		const at = await markVisitorRead(session.conversationId)
		if (!at) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		publishToAdmins({
			type: 'read',
			by: 'visitor',
			conversationId: session.conversationId,
			at: at.toISOString()
		})
		return { ok: true }
	})
	// когда оператор в последний раз читал беседу — для «Прочитано» в виджете
	.get('/widget/state', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const at = await getAdminReadAt(session.conversationId)
		return { adminLastReadAt: at ? at.toISOString() : null }
	})
	.get(
		'/widget/messages',
		async ({ headers, query, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return getMessages(session.conversationId, query)
		},
		{
			query: t.Object({
				limit: t.Optional(t.Numeric()),
				before: t.Optional(t.Numeric())
			})
		}
	)
	// вся история беседы текстовым файлом — кнопка «Скачать историю» в виджете
	.get('/widget/export', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const text = await exportConversationText(session.conversationId)
		if (!text) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		set.headers['content-type'] = 'text/plain; charset=utf-8'
		set.headers['content-disposition'] =
			`attachment; filename="conversation-${session.conversationId}.txt"`
		return text
	})
