import { Elysia } from 'elysia'
import { TELEGRAM_WEBHOOK_SECRET } from '../config'
import { addMessage } from '../chat/service'
import { publishMessage } from '../chat/events'
import { allowVisitorMessage } from '../chat/rate-limit'
import { getOrCreateConversationForChat } from '../telegram/service'

// апдейт от Telegram: нас интересует только обычное текстовое сообщение
type TelegramUpdate = {
	message?: {
		chat?: { id?: number | string }
		text?: string
	}
}

export const telegramRoutes = new Elysia().post(
	'/telegram/webhook',
	async ({ headers, body, set }) => {
		// без секрета сюда мог бы постучаться кто угодно, кто узнал URL —
		// Telegram присылает этот заголовок на каждый запрос, если секрет задан при setWebhook
		if (
			TELEGRAM_WEBHOOK_SECRET &&
			headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET
		) {
			set.status = 401
			return { error: 'Unauthorized' }
		}

		const update = body as TelegramUpdate
		const chatId = update.message?.chat?.id
		const text = update.message?.text?.trim()
		// Telegram ждёt 200 даже если апдейт нам неинтересен (стикер, фото, /start
		// без текста и т.п.) — иначе будет слать повторно
		if (chatId === undefined || !text) return { ok: true }

		const conversationId = await getOrCreateConversationForChat(String(chatId))
		if (!allowVisitorMessage(conversationId)) return { ok: true }

		const msg = await addMessage(conversationId, 'visitor', text)
		publishMessage(conversationId, msg)
		return { ok: true }
	}
)
