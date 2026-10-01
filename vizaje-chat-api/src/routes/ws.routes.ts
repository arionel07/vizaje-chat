import { Elysia } from 'elysia'
import jwt from 'jsonwebtoken'
import { verifyToken } from '../auth/guard'
import { findBotResponseByTrigger } from '../bot-responses/service'
import { allowVisitorMessage } from '../chat/rate-limit'
import {
	addMessage,
	conversationExists,
	replyTargetExists
} from '../chat/service'
import { verifySessionToken } from '../widget/service'

type ConnStore =
	| { type: 'visitor'; conversationId: number }
	| { type: 'admin'; email: string }

const connections = new Map<string, ConnStore>()

// «печатает»: не чаще раза в секунду с соединения, остальное молча отбрасываем
const TYPING_MIN_INTERVAL_MS = 1000
const lastTyping = new Map<string, number>()

const MAX_TEXT_LENGTH = 4000

// Elysia парсит JSON-строку в объект сам; невалидный JSON приходит строкой
function parseText(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null
	const text = (body as { text?: unknown }).text
	if (typeof text !== 'string') return null
	const trimmed = text.trim()
	if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return null
	return trimmed
}

// Необязательный id сообщения, на которое отвечаем: undefined — не указан, null — некорректный
function getReplyToId(body: unknown): number | null | undefined {
	if (typeof body !== 'object' || body === null) return undefined
	const id = (body as { replyToId?: unknown }).replyToId
	if (id === undefined) return undefined
	return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

// Необязательный идентификатор сообщения от клиента: возвращается в ошибке,
// чтобы клиент мог понять, какое именно сообщение отклонено
function getClientId(body: unknown): string | undefined {
	if (typeof body !== 'object' || body === null) return undefined
	const id = (body as { clientId?: unknown }).clientId
	return typeof id === 'string' ? id.slice(0, 64) : undefined
}

// язык посетителя (из data-lang виджета) — какой из answerRu/answerRo бот отдаст;
// нераспознанное значение не ломает поток — просто отвечаем по-русски
function getLang(body: unknown): 'ru' | 'ro' {
	if (typeof body !== 'object' || body === null) return 'ru'
	const lang = (body as { lang?: unknown }).lang
	return lang === 'ro' ? 'ro' : 'ru'
}

function sendError(
	ws: { send: (data: string) => unknown },
	error: string,
	clientId?: string
) {
	ws.send(JSON.stringify({ type: 'error', error, clientId }))
}

// Подтверждение отправителю (сам он publish не получает): серверные id и время
// сообщения нужны для «Прочитано» и для замены оптимистичного сообщения
function sendAck(
	ws: { send: (data: string) => unknown },
	msg: { id: number; conversationId: number; createdAt: Date },
	clientId?: string
) {
	ws.send(
		JSON.stringify({
			type: 'sent',
			clientId,
			id: msg.id,
			conversationId: msg.conversationId,
			createdAt: msg.createdAt
		})
	)
}

export const wsRoutes = new Elysia().ws('/ws', {
	open(ws) {
		const token = ws.data.query.token as string | undefined
		const decoded = token ? (jwt.decode(token) as any) : null

		if (!decoded || (decoded.type !== 'visitor' && decoded.type !== 'admin')) {
			ws.close()
			return
		}

		let store: ConnStore
		if (decoded.type === 'visitor') {
			const session = verifySessionToken(`Bearer ${token}`)
			if (!session) {
				ws.close()
				return
			}
			store = { type: 'visitor', conversationId: session.conversationId }
		} else {
			const admin = verifyToken(`Bearer ${token}`)
			if (!admin) {
				ws.close()
				return
			}
			store = { type: 'admin', email: admin.email }
		}

		console.log(
			'WS connected:',
			store.type === 'visitor'
				? `visitor, conversation ${store.conversationId}`
				: 'admin'
		)
		connections.set(ws.id, store)
		ws.subscribe(
			store.type === 'visitor'
				? `conversation:${store.conversationId}`
				: 'admin:global'
		)
	},
	async message(ws, body) {
		const store = connections.get(ws.id)
		if (!store) return

		// служебное событие «печатает» — не сообщение, в БД не пишется
		if ((body as { type?: unknown } | null)?.type === 'typing') {
			const now = Date.now()
			if (now - (lastTyping.get(ws.id) ?? 0) < TYPING_MIN_INTERVAL_MS) return
			lastTyping.set(ws.id, now)
			if (store.type === 'visitor') {
				ws.publish(
					'admin:global',
					JSON.stringify({
						type: 'typing',
						from: 'visitor',
						conversationId: store.conversationId
					})
				)
			} else {
				const id = (body as { conversationId?: unknown }).conversationId
				if (typeof id === 'number' && Number.isInteger(id)) {
					ws.publish(
						`conversation:${id}`,
						JSON.stringify({ type: 'typing', from: 'admin', conversationId: id })
					)
				}
			}
			return
		}

		const clientId = getClientId(body)
		const text = parseText(body)
		const replyToId = getReplyToId(body)
		if (!text || replyToId === null) {
			sendError(ws, 'Invalid message', clientId)
			return
		}

		if (store.type === 'visitor') {
			if (!allowVisitorMessage(store.conversationId)) {
				sendError(ws, 'Too many messages', clientId)
				return
			}
			if (replyToId && !(await replyTargetExists(store.conversationId, replyToId))) {
				sendError(ws, 'Reply target not found', clientId)
				return
			}
			const msg = await addMessage(store.conversationId, 'visitor', text, replyToId)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${store.conversationId}`, payload)
			ws.publish('admin:global', payload)
			sendAck(ws, msg, clientId)

			// точное совпадение с триггером (например, клик по quick-reply кнопке) —
			// бот отвечает сам, без участия оператора; не совпало — ждёт оператора как раньше
			const botResponse = await findBotResponseByTrigger(text)
			if (botResponse) {
				const lang = getLang(body)
				const answer = lang === 'ro' ? botResponse.answerRo : botResponse.answerRu
				const botMsg = await addMessage(store.conversationId, 'bot', answer)
				const botPayload = JSON.stringify(botMsg)
				ws.publish(`conversation:${store.conversationId}`, botPayload)
				ws.publish('admin:global', botPayload)
				// ws.publish не шлёт отправителю его же публикацию, а получатель бота — он и есть
				ws.send(botPayload)
			}
		}

		if (store.type === 'admin') {
			const conversationId = (body as { conversationId?: unknown })
				.conversationId
			if (
				typeof conversationId !== 'number' ||
				!Number.isInteger(conversationId) ||
				!(await conversationExists(conversationId))
			) {
				sendError(ws, 'Conversation not found', clientId)
				return
			}
			if (replyToId && !(await replyTargetExists(conversationId, replyToId))) {
				sendError(ws, 'Reply target not found', clientId)
				return
			}
			const msg = await addMessage(conversationId, 'admin', text, replyToId)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${conversationId}`, payload)
			ws.publish('admin:global', payload)
			sendAck(ws, msg, clientId)
		}
	},
	close(ws) {
		connections.delete(ws.id)
		lastTyping.delete(ws.id)
	}
})
