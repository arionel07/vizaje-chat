import { Elysia } from 'elysia'
import { TELEGRAM_WEBHOOK_SECRET } from '../config'
import { handleTelegramCallback, handleTelegramText } from '../telegram/flow'

// апдейт от Telegram: либо обычное сообщение, либо нажатие inline-кнопки
type TelegramUpdate = {
	message?: {
		chat?: { id?: number | string }
		text?: string
	}
	callback_query?: {
		id: string
		data?: string
		message?: { chat?: { id?: number | string }; message_id?: number }
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

		const callback = update.callback_query
		const callbackChatId = callback?.message?.chat?.id
		if (callback && callbackChatId !== undefined && callback.data) {
			await handleTelegramCallback(
				String(callbackChatId),
				callback.data,
				callback.id,
				callback.message?.message_id
			)
			return { ok: true }
		}

		const chatId = update.message?.chat?.id
		const text = update.message?.text?.trim()
		// Telegram ждёт 200 даже если апдейт нам неинтересен (стикер, фото и т.п.) —
		// иначе будет слать повторно
		if (chatId === undefined || !text) return { ok: true }

		await handleTelegramText(String(chatId), text)
		return { ok: true }
	}
)
