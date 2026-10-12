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

// идемпотентно: один chatId — одна беседа, при повторном сообщении находим ту же
// (тот же приём, что и getOrCreateConversationId у виджета, см. widget/service.ts)
export async function getOrCreateConversationForChat(chatId: string) {
	const sessionId = sessionIdForChat(chatId)

	const [existing] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (existing) return existing.id

	const [inserted] = await db
		.insert(conversations)
		.values({ sessionId, channel: 'telegram', telegramChatId: chatId })
		.onConflictDoNothing({ target: conversations.sessionId })
		.returning({ id: conversations.id })
	if (inserted) return inserted.id

	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (!row) throw new Error('Failed to get or create Telegram conversation')
	return row.id
}
