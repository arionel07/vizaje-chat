import { Elysia } from 'elysia'
import { TELEGRAM_WEBHOOK_SECRET } from '../config'
import { handleTelegramCallback, handleTelegramPhoto, handleTelegramText } from '../telegram/flow'

// апдейт от Telegram: обычное сообщение (текст/фото/картинка-документ) или
// нажатие inline-кнопки
type TelegramUpdate = {
	message?: {
		chat?: { id?: number | string }
		text?: string
		caption?: string
		// Telegram шлёт несколько размеров одного фото — берём последний (самый крупный)
		photo?: { file_id: string }[]
		document?: { file_id: string; mime_type?: string }
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

		const message = update.message
		const chatId = message?.chat?.id
		if (chatId === undefined) return { ok: true }

		// сжатое фото (обычная отправка картинки из галереи) — Telegram не даёт
		// mime, берём последний (самый крупный) элемент массива размеров
		const photo = message?.photo
		if (photo && photo.length > 0) {
			await handleTelegramPhoto(
				String(chatId),
				photo[photo.length - 1]!.file_id,
				message?.caption,
				undefined
			)
			return { ok: true }
		}
		// картинка, отправленная «как файл» (без сжатия) — mime_type есть у документа
		const document = message?.document
		if (document?.mime_type?.startsWith('image/')) {
			await handleTelegramPhoto(String(chatId), document.file_id, message?.caption, document.mime_type)
			return { ok: true }
		}

		const text = message?.text?.trim()
		// Telegram ждёт 200 даже если апдейт нам неинтересен (стикер, не-картинка-документ и т.п.) —
		// иначе будет слать повторно
		if (!text) return { ok: true }

		await handleTelegramText(String(chatId), text)
		return { ok: true }
	}
)
