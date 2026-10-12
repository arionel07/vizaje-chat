import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { conversations } from '../src/db/schema'
import { setTelegramSender } from '../src/telegram/service'
import { api, connectWs, makeAdmin, resetDb } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

describe('Telegram-канал', () => {
	test('входящее сообщение заводит беседу с channel=telegram и приходит админу с этой пометкой', async () => {
		const admin = await connectWs(adminToken)

		const res = await api('/telegram/webhook', {
			method: 'POST',
			body: { message: { chat: { id: 555 }, text: 'привет, это из телеграма' } }
		})
		expect(res.status).toBe(200)

		const got = await admin.waitFor(m => m.text === 'привет, это из телеграма')
		expect(got).toMatchObject({ sender: 'visitor' })

		const [conversation] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, got.conversationId))
		expect(conversation).toMatchObject({
			channel: 'telegram',
			telegramChatId: '555'
		})

		admin.close()
	})

	test('повторное сообщение с тем же chat_id — та же беседа, не новая', async () => {
		await api('/telegram/webhook', {
			method: 'POST',
			body: { message: { chat: { id: 777 }, text: 'первое' } }
		})
		await api('/telegram/webhook', {
			method: 'POST',
			body: { message: { chat: { id: 777 }, text: 'второе' } }
		})

		const rows = await db
			.select()
			.from(conversations)
			.where(eq(conversations.telegramChatId, '777'))
		expect(rows).toHaveLength(1)
	})

	test('апдейт без текста (например, стикер) не создаёт беседу, отвечает 200', async () => {
		const res = await api('/telegram/webhook', {
			method: 'POST',
			body: { message: { chat: { id: 999 } } }
		})
		expect(res.status).toBe(200)

		const rows = await db
			.select()
			.from(conversations)
			.where(eq(conversations.telegramChatId, '999'))
		expect(rows).toHaveLength(0)
	})

	test('ответ оператора из админки дублируется в Telegram', async () => {
		const sent: { chatId: string; text: string }[] = []
		setTelegramSender(async (chatId, text) => {
			sent.push({ chatId, text })
		})

		await api('/telegram/webhook', {
			method: 'POST',
			body: { message: { chat: { id: 321 }, text: 'вопрос из телеграма' } }
		})
		const [conversation] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.telegramChatId, '321'))

		const admin = await connectWs(adminToken)
		admin.send({ conversationId: conversation!.id, text: 'ответ оператора' })
		await admin.waitFor(m => m.type === 'sent')
		admin.close()

		expect(sent).toEqual([{ chatId: '321', text: 'ответ оператора' }])
	})
})
