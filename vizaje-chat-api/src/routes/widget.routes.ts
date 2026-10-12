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
import {
	createSession,
	findConversationIdBySessionId,
	getOrCreateConversationId,
	verifySessionToken
} from '../widget/service'

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
	// HTTP-путь отправки сообщения (основной — через WS, см. ws.routes.ts); беседа
	// заводится здесь же, в момент первого сообщения — не раньше
	.post(
		'/widget/messages',
		async ({ headers, body, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			const conversationId = await getOrCreateConversationId(session.sessionId)
			if (!allowVisitorMessage(conversationId)) {
				set.status = 429
				return { error: 'Too many messages' }
			}
			if (
				body.replyToId &&
				!(await replyTargetExists(conversationId, body.replyToId))
			) {
				set.status = 404
				return { error: 'Reply target not found' }
			}
			const msg = await addMessage(
				conversationId,
				'visitor',
				body.text,
				body.replyToId
			)
			publishMessage(conversationId, msg)
			return msg
		},
		{
			body: t.Object({
				text: t.String(),
				replyToId: t.Optional(t.Integer({ minimum: 1 }))
			})
		}
	)
	// посетитель увидел сообщения — оператор покажет «Прочитано».
	// Беседы ещё нет (ничего не писал) — читать нечего, это не ошибка
	.post('/widget/read', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const conversationId = await findConversationIdBySessionId(session.sessionId)
		if (conversationId === null) return { ok: true }
		if (!allowVisitorRead(conversationId)) {
			set.status = 429
			return { error: 'Too many requests' }
		}
		const at = await markVisitorRead(conversationId)
		if (!at) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		publishToAdmins({
			type: 'read',
			by: 'visitor',
			conversationId,
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
		const conversationId = await findConversationIdBySessionId(session.sessionId)
		if (conversationId === null) return { adminLastReadAt: null }
		const at = await getAdminReadAt(conversationId)
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
			const conversationId = await findConversationIdBySessionId(session.sessionId)
			if (conversationId === null) return []
			return getMessages(conversationId, query)
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
		const conversationId = await findConversationIdBySessionId(session.sessionId)
		const text = conversationId === null ? null : await exportConversationText(conversationId)
		if (!text) {
			set.status = 404
			return { error: 'Conversation not found' }
		}
		set.headers['content-type'] = 'text/plain; charset=utf-8'
		set.headers['content-disposition'] =
			`attachment; filename="conversation-${conversationId}.txt"`
		return text
	})
