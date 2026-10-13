import { eq } from 'drizzle-orm'
import { TELEGRAM_BOT_TOKEN } from '../config'
import { db } from '../db/client'
import { conversations } from '../db/schema'

// sessionId у telegram-бесед синтетический (в отличие от UUID у виджета),
// но тоже уникален — переиспользуем ту же колонку/constraint, не заводя отдельную
export const sessionIdForChat = (chatId: string) => `telegram:${chatId}`

type Sender = (chatId: string, text: string) => Promise<unknown>

// настоящая отправка — вызов Bot API; подменяется в тестах через setSender,
// как publisher в chat/events.ts
let sender: Sender = async (chatId, text) => {
	if (!TELEGRAM_BOT_TOKEN) {
		console.error('TELEGRAM_BOT_TOKEN не задан — сообщение в Telegram не отправлено')
		return
	}
	const res = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chat_id: chatId, text })
		}
	)
	if (!res.ok) {
		console.error('Telegram sendMessage failed:', res.status, await res.text().catch(() => ''))
	}
}

export function setTelegramSender(fn: Sender) {
	sender = fn
}

export async function sendTelegramMessage(chatId: string, text: string) {
	await sender(chatId, text)
}

export type Button = { text: string; data: string }

type KeyboardSender = (chatId: string, text: string, rows: Button[][]) => Promise<unknown>

let keyboardSender: KeyboardSender = async (chatId, text, rows) => {
	if (!TELEGRAM_BOT_TOKEN) {
		console.error('TELEGRAM_BOT_TOKEN не задан — сообщение в Telegram не отправлено')
		return
	}
	const res = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				reply_markup: {
					inline_keyboard: rows.map(row =>
						row.map(b => ({ text: b.text, callback_data: b.data }))
					)
				}
			})
		}
	)
	if (!res.ok) {
		console.error(
			'Telegram sendMessage (keyboard) failed:',
			res.status,
			await res.text().catch(() => '')
		)
	}
}

export function setTelegramKeyboardSender(fn: KeyboardSender) {
	keyboardSender = fn
}

// меню — каждая строка rows[] своя строка кнопок под сообщением
export async function sendTelegramButtons(chatId: string, text: string, rows: Button[][]) {
	await keyboardSender(chatId, text, rows)
}

// без этого кнопка в Telegram-клиенте продолжает «крутиться» после нажатия
export async function answerTelegramCallback(callbackQueryId: string) {
	if (!TELEGRAM_BOT_TOKEN) return
	await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ callback_query_id: callbackQueryId })
		}
	).catch(error => console.error('answerCallbackQuery failed:', error))
}

type KeyboardClearer = (chatId: string, messageId: number) => Promise<unknown>

// снимает клавиатуру с уже обработанного сообщения — иначе старые кнопки
// остаются кликабельными вечно, и нажатие на экран из прошлого «отматывает»
// состояние назад (поймано на реальном тесте: нажали кнопку в Telegram
// на давно пройденном FAQ-экране уже после перехода в режим поддержки)
let keyboardClearer: KeyboardClearer = async (chatId, messageId) => {
	if (!TELEGRAM_BOT_TOKEN) return
	await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: chatId,
				message_id: messageId,
				reply_markup: { inline_keyboard: [] }
			})
		}
	).catch(error => console.error('editMessageReplyMarkup failed:', error))
}

export function setTelegramKeyboardClearer(fn: KeyboardClearer) {
	keyboardClearer = fn
}

export async function clearTelegramKeyboard(chatId: string, messageId: number) {
	await keyboardClearer(chatId, messageId)
}

// беседа + chatId → { channel, telegramChatId } — чтобы при ответе оператора
// понять, нужно ли дублировать сообщение в Telegram (см. ws.routes.ts)
export async function getConversationChannel(conversationId: number) {
	const [row] = await db
		.select({
			channel: conversations.channel,
			telegramChatId: conversations.telegramChatId
		})
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return row ?? null
}

type PhotoSender = (chatId: string, photoUrl: string, caption?: string) => Promise<unknown>

// отправка картинки в Telegram по публичной ссылке (сам Bot API её скачивает) —
// используется, когда оператор отвечает с вложением (см. ws.routes.ts).
// Нужен PUBLIC_API_URL, иначе Telegram не сможет достучаться до нашего /uploads/...
let photoSender: PhotoSender = async (chatId, photoUrl, caption) => {
	if (!TELEGRAM_BOT_TOKEN) return
	const res = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
		{
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ chat_id: chatId, photo: photoUrl, caption })
		}
	)
	if (!res.ok) {
		console.error('Telegram sendPhoto failed:', res.status, await res.text().catch(() => ''))
	}
}

export function setTelegramPhotoSender(fn: PhotoSender) {
	photoSender = fn
}

export async function sendTelegramPhoto(chatId: string, photoUrl: string, caption?: string) {
	await photoSender(chatId, photoUrl, caption)
}

type FileDownloader = (
	fileId: string
) => Promise<{ buffer: ArrayBuffer; filePath: string } | null>

// скачивает файл, который посетитель прислал боту (фото/документ-картинка) —
// двухшаговый Bot API: getFile даёт file_path, затем обычный GET по нему.
// filePath нужен вызывающему коду, чтобы угадать расширение/mime (см. flow.ts)
let fileDownloader: FileDownloader = async fileId => {
	if (!TELEGRAM_BOT_TOKEN) return null
	const infoRes = await fetch(
		`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
	)
	if (!infoRes.ok) {
		console.error('Telegram getFile failed:', infoRes.status, await infoRes.text().catch(() => ''))
		return null
	}
	const info = (await infoRes.json()) as { ok: boolean; result?: { file_path?: string } }
	const filePath = info.result?.file_path
	if (!info.ok || !filePath) return null

	const fileRes = await fetch(`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`)
	if (!fileRes.ok) return null
	return { buffer: await fileRes.arrayBuffer(), filePath }
}

export function setTelegramFileDownloader(fn: FileDownloader) {
	fileDownloader = fn
}

export async function downloadTelegramFile(fileId: string) {
	return fileDownloader(fileId)
}

// идемпотентно: один chatId — одна беседа, при повторном сообщении находим ту же
// (тот же приём, что и getOrCreateConversationId у виджета, см. widget/service.ts).
// created — беседа только что заведена этим вызовом (а не найдена существующей) —
// нужно flow.ts, чтобы один раз на беседу показать оператору выбранную тему
export async function getOrCreateConversationForChat(
	chatId: string
): Promise<{ id: number; created: boolean }> {
	const sessionId = sessionIdForChat(chatId)

	const [existing] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (existing) return { id: existing.id, created: false }

	const [inserted] = await db
		.insert(conversations)
		.values({ sessionId, channel: 'telegram', telegramChatId: chatId })
		.onConflictDoNothing({ target: conversations.sessionId })
		.returning({ id: conversations.id })
	if (inserted) return { id: inserted.id, created: true }

	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (!row) throw new Error('Failed to get or create Telegram conversation')
	return { id: row.id, created: false }
}
