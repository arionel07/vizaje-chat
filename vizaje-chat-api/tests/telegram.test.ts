import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { conversations } from '../src/db/schema'
import {
	setTelegramKeyboardSender,
	setTelegramSender,
	type Button
} from '../src/telegram/service'
import { api, connectWs, makeAdmin, resetDb } from './helpers'

let adminToken: string

// перехватываем всё, что бот шлёт в Telegram — и обычный текст, и меню с кнопками
const texts: { chatId: string; text: string }[] = []
const keyboards: { chatId: string; text: string; rows: Button[][] }[] = []

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setTelegramSender(async (chatId, text) => {
		texts.push({ chatId, text })
	})
	setTelegramKeyboardSender(async (chatId, text, rows) => {
		keyboards.push({ chatId, text, rows })
	})
})

beforeEach(() => {
	texts.length = 0
	keyboards.length = 0
})

const message = (chatId: number, text: string) => ({
	method: 'POST' as const,
	body: { message: { chat: { id: chatId }, text } }
})
const callback = (chatId: number, data: string, id = `${chatId}-${data}`) => ({
	method: 'POST' as const,
	body: { callback_query: { id, data, message: { chat: { id: chatId } } } }
})
const lastKeyboardButtons = () => keyboards.at(-1)!.rows.flat()
const findConversationByChat = (chatId: number) =>
	db
		.select()
		.from(conversations)
		.where(eq(conversations.telegramChatId, String(chatId)))
		.then(rows => rows[0])

describe('Telegram-бот: навигация по меню (ничего не попадает в админку)', () => {
	test('первое сообщение — показывает кнопку Start, беседу не заводит', async () => {
		await api('/telegram/webhook', message(1001, '/start'))

		expect(keyboards).toHaveLength(1)
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['start'])
		expect(await findConversationByChat(1001)).toBeUndefined()
	})

	test('Start → язык → категория → FAQ-ответ — ни разу не создаёт беседу', async () => {
		const chatId = 1002
		await api('/telegram/webhook', callback(chatId, 'start'))
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['lang:ru', 'lang:ro'])

		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		expect(lastKeyboardButtons().map(b => b.data)).toEqual([
			'cat:retail',
			'cat:app',
			'cat:site',
			'back'
		])

		await api('/telegram/webhook', callback(chatId, 'cat:retail'))
		const faqButtons = lastKeyboardButtons()
		expect(faqButtons.at(-2)?.data).toBe('other:retail') // предпоследняя — «другой вопрос»
		expect(faqButtons.at(-1)?.data).toBe('back')

		// нажали на готовый вопрос — бот отвечает текстом, меню показывается снова
		const faqButtonData = faqButtons[0]!.data
		await api('/telegram/webhook', callback(chatId, faqButtonData))
		expect(texts).toHaveLength(1) // готовый ответ ушёл как обычный текст

		expect(await findConversationByChat(chatId)).toBeUndefined()
	})

	test('«Назад» возвращает на шаг выше', async () => {
		const chatId = 1003
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:retail'))
		await api('/telegram/webhook', callback(chatId, 'back'))
		// назад из FAQ — снова категории
		expect(lastKeyboardButtons().map(b => b.data)).toEqual([
			'cat:retail',
			'cat:app',
			'cat:site',
			'back'
		])
	})
})

describe('Telegram-бот: «другой вопрос» — единственный путь в админку', () => {
	test('после «Другой вопрос» свободный текст заводит беседу и приходит админу', async () => {
		const chatId = 2001
		const admin = await connectWs(adminToken)

		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:app'))
		await api('/telegram/webhook', callback(chatId, 'other:app'))
		expect(await findConversationByChat(chatId)).toBeUndefined() // всё ещё нет беседы

		await api('/telegram/webhook', message(chatId, 'у меня завис экран'))

		const got = await admin.waitFor(m => m.text === 'у меня завис экран')
		expect(got).toMatchObject({ sender: 'visitor' })
		const conversation = await findConversationByChat(chatId)
		expect(conversation).toMatchObject({ channel: 'telegram', telegramChatId: String(chatId) })
		expect(got.conversationId).toBe(conversation!.id)

		admin.close()
	})

	test('повторное сообщение в режиме поддержки — та же беседа, не новая', async () => {
		const chatId = 2002
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
		await api('/telegram/webhook', callback(chatId, 'other:site'))
		await api('/telegram/webhook', message(chatId, 'первое'))
		await api('/telegram/webhook', message(chatId, 'второе'))

		const rows = await db
			.select()
			.from(conversations)
			.where(eq(conversations.telegramChatId, String(chatId)))
		expect(rows).toHaveLength(1)
	})

	test('ответ оператора из админки дублируется в тот же чат Telegram', async () => {
		const chatId = 2003
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:retail'))
		await api('/telegram/webhook', callback(chatId, 'other:retail'))
		await api('/telegram/webhook', message(chatId, 'вопрос из телеграма'))
		const conversation = await findConversationByChat(chatId)

		const admin = await connectWs(adminToken)
		admin.send({ conversationId: conversation!.id, text: 'ответ оператора' })
		await admin.waitFor(m => m.type === 'sent')
		admin.close()

		expect(texts).toContainEqual({ chatId: String(chatId), text: 'ответ оператора' })
	})
})

describe('Telegram-бот: прочее', () => {
	test('апдейт без текста и без callback_data (например, стикер) — просто 200, ничего не создаёт', async () => {
		const res = await api('/telegram/webhook', { method: 'POST', body: { message: { chat: { id: 9999 } } } })
		expect(res.status).toBe(200)
		expect(await findConversationByChat(9999)).toBeUndefined()
	})
})
