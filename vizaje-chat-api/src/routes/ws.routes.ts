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
import {
	findConversationIdBySessionId,
	getOrCreateConversationId,
	verifySessionToken
} from '../widget/service'
import { getConversationChannel, sendTelegramMessage, sendTelegramPhoto } from '../telegram/service'
import { PUBLIC_API_URL } from '../config'
import { sendExpoPush } from '../push-tokens/expo-push'
import { getAllPushTokens } from '../push-tokens/service'
import { sendWebPush } from '../web-push/send'
import { getAllWebPushSubscriptions } from '../web-push/service'
import { parseAttachmentInput } from '../uploads/service'

type VisitorStore = {
	type: 'visitor'
	sessionId: string
	// null — посетитель ещё ничего не написал, беседы ещё нет; заводится и
	// привязывается к сокету лениво, в момент первого сообщения
	conversationId: number | null
	// пока conversationId не определён, несколько сообщений/typing-событий могут
	// прийти почти одновременно (клиент не ждёт завершения open() перед отправкой) —
	// single-flight: все ждут ОДИН и тот же запрос к БД, иначе порядок его
	// завершения не совпадает с порядком прихода и rate-limit считает не то
	// сообщение «шестым» (проверено тестом на лимит сообщений)
	resolving: Promise<number | null> | null
}
type ConnStore = VisitorStore | { type: 'admin'; email: string }

// allowCreate=false (typing): только читает — беседа должна уже существовать,
// иначе просто нечего транслировать. allowCreate=true (сообщение): при
// отсутствии беседы заводит её — единственное место, где это происходит
async function resolveConversationId(
	store: VisitorStore,
	ws: { subscribe: (room: string) => unknown },
	allowCreate: boolean
): Promise<number | null> {
	while (store.conversationId === null) {
		if (!store.resolving) {
			store.resolving = allowCreate
				? getOrCreateConversationId(store.sessionId)
				: findConversationIdBySessionId(store.sessionId)
		}
		const id = await store.resolving
		store.resolving = null
		if (id !== null) {
			store.conversationId = id
			ws.subscribe(`conversation:${id}`)
			return id
		}
		if (!allowCreate) return null
	}
	return store.conversationId
}

const connections = new Map<string, ConnStore>()

// «печатает»: не чаще раза в секунду с соединения, остальное молча отбрасываем
const TYPING_MIN_INTERVAL_MS = 1000
const lastTyping = new Map<string, number>()

const MAX_TEXT_LENGTH = 4000

// Elysia парсит JSON-строку в объект сам; невалидный JSON приходит строкой.
// '' — текста нет (допустимо, если есть вложение), null — текст есть, но некорректен
function parseText(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return ''
	const text = (body as { text?: unknown }).text
	if (text === undefined) return ''
	if (typeof text !== 'string') return null
	const trimmed = text.trim()
	if (trimmed.length > MAX_TEXT_LENGTH) return null
	return trimmed
}

// вложение (картинка) из тела WS-сообщения — доверяем форме, которую сами же
// вернули из /widget|admin/upload (см. uploads/service.ts)
function getAttachment(body: unknown) {
	if (typeof body !== 'object' || body === null) return null
	return parseAttachmentInput(body as Record<string, unknown>)
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
	async open(ws) {
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
			store = {
				type: 'visitor',
				sessionId: session.sessionId,
				conversationId: null,
				resolving: null
			}
		} else {
			const admin = verifyToken(`Bearer ${token}`)
			if (!admin) {
				ws.close()
				return
			}
			store = { type: 'admin', email: admin.email }
		}

		// кладём запись СРАЗУ, до какого-либо await ниже: клиент может прислать
		// первое сообщение сразу после открытия сокета — быстрее, чем сервер
		// успеет закончить асинхронную подготовку, и message() просто дропнет
		// его, если к этому моменту соединения ещё нет в connections
		connections.set(ws.id, store)

		if (store.type === 'admin') {
			ws.subscribe('admin:global')
			console.log('WS connected: admin')
			return
		}

		// у новой сессии беседы ещё нет (не создаём, пока не напишет) — только читаем.
		// Используем тот же single-flight, что и message(): если сообщение придёт
		// раньше, чем этот поиск завершится, оно переиспользует этот же запрос
		// вместо того, чтобы запускать свой и гнаться с этим же
		await resolveConversationId(store, ws, false)
		console.log(
			'WS connected:',
			`visitor, conversation ${store.conversationId ?? '(нет, ещё не писал)'}`
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
				// не создаём беседу ради «печатает» — только если она уже есть
				// (или вот-вот появится из уже идущего resolveConversationId)
				const conversationId = await resolveConversationId(store, ws, false)
				if (conversationId !== null) {
					ws.publish(
						'admin:global',
						JSON.stringify({
							type: 'typing',
							from: 'visitor',
							conversationId
						})
					)
				}
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
		const attachment = getAttachment(body)
		const replyToId = getReplyToId(body)
		if (text === null || replyToId === null || (!text && !attachment)) {
			sendError(ws, 'Invalid message', clientId)
			return
		}

		if (store.type === 'visitor') {
			// первое сообщение этой сессии — заводим беседу только сейчас и
			// подписываем сокет на её комнату (раньше подписки не было)
			const conversationId = await resolveConversationId(store, ws, true)
			if (conversationId === null) throw new Error('unreachable: allowCreate=true always returns an id')
			if (!allowVisitorMessage(conversationId)) {
				sendError(ws, 'Too many messages', clientId)
				return
			}
			if (replyToId && !(await replyTargetExists(conversationId, replyToId))) {
				sendError(ws, 'Reply target not found', clientId)
				return
			}
			const msg = await addMessage(conversationId, 'visitor', text, replyToId, attachment)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${conversationId}`, payload)
			ws.publish('admin:global', payload)
			sendAck(ws, msg, clientId)

			// push — best-effort, не блокирует обработку сообщения
			getAllPushTokens()
				.then(tokens =>
					sendExpoPush(tokens, {
						title: `Беседа #${conversationId}`,
						body: text,
						data: { conversationId }
					})
				)
				.catch(error => console.error('Failed to notify admins:', error))
			getAllWebPushSubscriptions()
				.then(subs =>
					sendWebPush(subs, {
						title: `Беседа #${conversationId}`,
						body: text,
						data: { conversationId }
					})
				)
				.catch(error => console.error('Failed to send web push to admins:', error))

			// точное совпадение с триггером (например, клик по quick-reply кнопке) —
			// бот отвечает сам, без участия оператора; не совпало — ждёт оператора как раньше
			const botResponse = text ? await findBotResponseByTrigger(text) : null
			if (botResponse) {
				const lang = getLang(body)
				const answer = lang === 'ro' ? botResponse.answerRo : botResponse.answerRu
				const botMsg = await addMessage(conversationId, 'bot', answer)
				const botPayload = JSON.stringify(botMsg)
				ws.publish(`conversation:${conversationId}`, botPayload)
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
			const msg = await addMessage(conversationId, 'admin', text, replyToId, attachment)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${conversationId}`, payload)
			ws.publish('admin:global', payload)
			sendAck(ws, msg, clientId)

			// беседа из Telegram — оператор отвечает прямо из админки, без
			// переключения в сам Telegram; дублируем ответ туда, best-effort
			const info = await getConversationChannel(conversationId)
			if (info?.channel === 'telegram' && info.telegramChatId) {
				const chatId = info.telegramChatId
				if (attachment && PUBLIC_API_URL) {
					// Bot API сам скачивает фото по ссылке — нужен публичный, не relative, URL
					sendTelegramPhoto(chatId, `${PUBLIC_API_URL}${attachment.url}`, text || undefined).catch(
						error => console.error('Failed to relay photo to Telegram:', error)
					)
				} else {
					if (attachment && !PUBLIC_API_URL) {
						console.error(
							'PUBLIC_API_URL не задан — картинка в Telegram не продублирована, только текст'
						)
					}
					if (text) {
						sendTelegramMessage(chatId, text).catch(error =>
							console.error('Failed to relay reply to Telegram:', error)
						)
					}
				}
			}
		}
	},
	close(ws) {
		connections.delete(ws.id)
		lastTyping.delete(ws.id)
	}
})
