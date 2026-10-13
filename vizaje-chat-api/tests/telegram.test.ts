import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { conversations } from '../src/db/schema'
import {
	setTelegramFileDownloader,
	setTelegramKeyboardClearer,
	setTelegramKeyboardSender,
	setTelegramPhotoSender,
	setTelegramSender,
	type Button
} from '../src/telegram/service'
import { api, connectWs, makeAdmin, resetDb, TINY_PNG_BASE64 } from './helpers'

let adminToken: string

// перехватываем всё, что бот шлёт в Telegram — и обычный текст, и меню с кнопками
const texts: { chatId: string; text: string }[] = []
const keyboards: { chatId: string; text: string; rows: Button[][] }[] = []
const clearedKeyboards: { chatId: string; messageId: number }[] = []
const photos: { chatId: string; photoUrl: string; caption?: string }[] = []
// file_id → содержимое, которое "скачает" подменённый downloadTelegramFile
const fakeTelegramFiles = new Map<string, { buffer: ArrayBuffer; filePath: string }>()

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setTelegramSender(async (chatId, text) => {
		texts.push({ chatId, text })
	})
	setTelegramKeyboardSender(async (chatId, text, rows) => {
		keyboards.push({ chatId, text, rows })
	})
	setTelegramKeyboardClearer(async (chatId, messageId) => {
		clearedKeyboards.push({ chatId, messageId })
	})
	setTelegramPhotoSender(async (chatId, photoUrl, caption) => {
		photos.push({ chatId, photoUrl, caption })
	})
	setTelegramFileDownloader(async fileId => fakeTelegramFiles.get(fileId) ?? null)
})

beforeEach(() => {
	texts.length = 0
	keyboards.length = 0
	clearedKeyboards.length = 0
	photos.length = 0
	fakeTelegramFiles.clear()
})

const pngBuffer = () => Uint8Array.from(atob(TINY_PNG_BASE64), c => c.charCodeAt(0)).buffer
// регистрирует fileId как "скачиваемый" — filePath решает угадываемый mime (см. flow.ts)
const registerFakeFile = (fileId: string, filePath = 'photos/file.jpg') =>
	fakeTelegramFiles.set(fileId, { buffer: pngBuffer(), filePath })

const message = (chatId: number, text: string) => ({
	method: 'POST' as const,
	body: { message: { chat: { id: chatId }, text } }
})
const photoMessage = (chatId: number, fileId: string, caption?: string) => ({
	method: 'POST' as const,
	body: { message: { chat: { id: chatId }, photo: [{ file_id: fileId }], caption } }
})
const documentMessage = (chatId: number, fileId: string, mimeType: string, caption?: string) => ({
	method: 'POST' as const,
	body: {
		message: { chat: { id: chatId }, document: { file_id: fileId, mime_type: mimeType }, caption }
	}
})
// messageId — id сообщения, под которым была нажата кнопка (для снятия клавиатуры)
const callback = (
	chatId: number,
	data: string,
	{ id = `${chatId}-${data}`, messageId }: { id?: string; messageId?: number } = {}
) => ({
	method: 'POST' as const,
	body: {
		callback_query: {
			id,
			data,
			message: { chat: { id: chatId }, ...(messageId !== undefined ? { message_id: messageId } : {}) }
		}
	}
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

	test('Start → язык → категория — сразу просьба написать вопрос, беседу не заводит', async () => {
		const chatId = 1002
		await api('/telegram/webhook', callback(chatId, 'start'))
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['lang:ru', 'lang:ro'])

		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		expect(lastKeyboardButtons().map(b => b.data)).toEqual([
			'cat:retail',
			'cat:app',
			'cat:site',
			'cat:other',
			'back'
		])

		await api('/telegram/webhook', callback(chatId, 'cat:retail'))
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['back']) // только кнопка назад
		expect(texts).toHaveLength(0) // никакого готового ответа — просим написать своими словами

		expect(await findConversationByChat(chatId)).toBeUndefined()
	})

	test('«Назад» возвращает на шаг выше', async () => {
		const chatId = 1003
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:retail'))
		await api('/telegram/webhook', callback(chatId, 'back'))
		// назад из режима «напишите вопрос» — снова категории
		expect(lastKeyboardButtons().map(b => b.data)).toEqual([
			'cat:retail',
			'cat:app',
			'cat:site',
			'cat:other',
			'back'
		])
	})

	test('нажатие кнопки снимает клавиатуру именно с того сообщения, где её нажали', async () => {
		const chatId = 1005
		await api('/telegram/webhook', callback(chatId, 'start', { messageId: 501 }))
		expect(clearedKeyboards).toContainEqual({ chatId: String(chatId), messageId: 501 })

		await api('/telegram/webhook', callback(chatId, 'lang:ru', { messageId: 502 }))
		expect(clearedKeyboards).toContainEqual({ chatId: String(chatId), messageId: 502 })
		expect(clearedKeyboards).toHaveLength(2)
	})

	test('/start в режиме «напишите вопрос» сбрасывает меню, а не форвардится как обычный текст', async () => {
		const chatId = 1006
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:retail')) // теперь step: 'support'

		await api('/telegram/webhook', message(chatId, '/start'))

		// снова экран Start, а не «Спасибо, передал оператору» на /start как на обычный текст
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['start'])
		expect(texts).toHaveLength(0)
		expect(await findConversationByChat(chatId)).toBeUndefined()

		// после сброса меню обычный текст (без выбора категории заново) тоже не форвардится
		await api('/telegram/webhook', message(chatId, 'sdf'))
		expect(await findConversationByChat(chatId)).toBeUndefined()
	})

	test('категория «Другое» ведёт себя так же — сразу просит написать вопрос', async () => {
		const chatId = 1004
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:other'))

		expect(keyboards).toHaveLength(3) // start + lang/категории + просьба написать (с кнопкой назад)
		expect(keyboards.at(-1)?.text).toMatch(/опишите вашу проблему/i)
		expect(await findConversationByChat(chatId)).toBeUndefined()
	})
})

describe('Telegram-бот: свободный текст после выбора категории — единственный путь в админку', () => {
	test('после выбора категории свободный текст заводит беседу и приходит админу', async () => {
		const chatId = 2001
		const admin = await connectWs(adminToken)

		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:app'))
		expect(await findConversationByChat(chatId)).toBeUndefined() // всё ещё нет беседы

		await api('/telegram/webhook', message(chatId, 'у меня завис экран'))

		const got = await admin.waitFor(m => m.text === 'у меня завис экран')
		expect(got).toMatchObject({ sender: 'visitor' })
		const conversation = await findConversationByChat(chatId)
		expect(conversation).toMatchObject({ channel: 'telegram', telegramChatId: String(chatId) })
		expect(got.conversationId).toBe(conversation!.id)
		// сразу после — благодарность на языке, который выбрал посетитель
		expect(texts.at(-1)?.text).toMatch(/спасибо/i)

		admin.close()
	})

	test('оператору приходит системным сообщением выбранная тема — один раз за заход, но заново при новом обращении', async () => {
		const chatId = 2005
		const admin = await connectWs(adminToken)

		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:app'))
		await api('/telegram/webhook', message(chatId, 'первое сообщение'))

		const categoryMsg = await admin.waitFor(m => m.sender === 'system')
		expect(categoryMsg.text).toBe('Тема: Приложение')
		const conversation = await findConversationByChat(chatId)
		expect(categoryMsg.conversationId).toBe(conversation!.id)

		// второе сообщение в том же заходе — тему повторно не присылаем
		const systemCountBefore = admin.messages.filter(m => m.sender === 'system').length
		await api('/telegram/webhook', message(chatId, 'второе сообщение'))
		await admin.waitFor(m => m.text === 'второе сообщение')
		const systemCountAfter = admin.messages.filter(m => m.sender === 'system').length
		expect(systemCountAfter).toBe(systemCountBefore)

		// человек вернулся позже с другой проблемой — снова проходит меню,
		// выбирает другую категорию: тема должна прийти заново, уже новая
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
		await api('/telegram/webhook', message(chatId, 'теперь другой вопрос'))

		const systemMessages = admin.messages.filter(m => m.sender === 'system')
		expect(systemMessages.at(-1)?.text).toBe('Тема: Сайт')
		expect(systemMessages).toHaveLength(2) // старая "Приложение" + новая "Сайт"
		// беседа та же самая — не новая
		const sameConversation = await findConversationByChat(chatId)
		expect(sameConversation!.id).toBe(conversation!.id)

		admin.close()
	})

	test('категория «Другое»: вопрос тоже доходит до админа и приходит благодарность', async () => {
		const chatId = 2004
		const admin = await connectWs(adminToken)

		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ro'))
		await api('/telegram/webhook', callback(chatId, 'cat:other'))
		await api('/telegram/webhook', message(chatId, 'altceva, nu se potrivește'))

		const got = await admin.waitFor(m => m.text === 'altceva, nu se potrivește')
		expect(got).toMatchObject({ sender: 'visitor' })
		expect(texts.at(-1)?.text).toMatch(/mulțumim/i) // благодарность на румынском

		admin.close()
	})

	test('повторное сообщение в режиме поддержки — та же беседа, не новая', async () => {
		const chatId = 2002
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
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
		await api('/telegram/webhook', message(chatId, 'вопрос из телеграма'))
		const conversation = await findConversationByChat(chatId)

		const admin = await connectWs(adminToken)
		admin.send({ conversationId: conversation!.id, text: 'ответ оператора' })
		await admin.waitFor(m => m.type === 'sent')
		admin.close()

		expect(texts).toContainEqual({ chatId: String(chatId), text: 'ответ оператора' })
	})
})

describe('Telegram-бот: фото/картинка — доходит до админа, как и текст', () => {
	test('фото вне режима поддержки — игнорируется (перезапускает меню, в админку не попадает)', async () => {
		const chatId = 3001
		registerFakeFile('f1')
		await api('/telegram/webhook', photoMessage(chatId, 'f1'))

		expect(await findConversationByChat(chatId)).toBeUndefined()
		expect(lastKeyboardButtons().map(b => b.data)).toEqual(['start']) // showStart
	})

	test('фото в режиме поддержки — скачивается, сохраняется, доходит до админа с подписью', async () => {
		const chatId = 3002
		const admin = await connectWs(adminToken)
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:app'))

		registerFakeFile('f2', 'photos/abc.jpg')
		await api('/telegram/webhook', photoMessage(chatId, 'f2', 'вот скрин ошибки'))

		const got = await admin.waitFor(m => m.attachmentUrl)
		expect(got).toMatchObject({ sender: 'visitor', text: 'вот скрин ошибки', attachmentType: 'image/jpeg' })
		expect(got.attachmentUrl).toMatch(/^\/uploads\/[\w-]+\.jpg$/)
		expect(texts.at(-1)?.text).toMatch(/спасибо/i)

		admin.close()
	})

	test('картинка-документ (без сжатия) — mime берётся из document.mime_type', async () => {
		const chatId = 3003
		const admin = await connectWs(adminToken)
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))

		registerFakeFile('f3', 'documents/file_42')
		await api('/telegram/webhook', documentMessage(chatId, 'f3', 'image/png'))

		const got = await admin.waitFor(m => m.attachmentUrl)
		expect(got).toMatchObject({ attachmentType: 'image/png' })

		admin.close()
	})

	test('документ не-картинка — не обрабатывается как фото, просто 200', async () => {
		const chatId = 3004
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
		registerFakeFile('f4', 'documents/report.pdf')

		const res = await api('/telegram/webhook', documentMessage(chatId, 'f4', 'application/pdf'))
		expect(res.status).toBe(200)
		expect(await findConversationByChat(chatId)).toBeUndefined()
	})

	test('скачать файл не удалось — сообщение об ошибке, беседа не заводится', async () => {
		const chatId = 3005
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
		// не регистрируем f5 — downloadTelegramFile вернёт null

		await api('/telegram/webhook', photoMessage(chatId, 'f5'))

		expect(texts.at(-1)?.text).toMatch(/не удалось загрузить/i)
		expect(await findConversationByChat(chatId)).toBeUndefined()
	})

	test('ответ оператора с картинкой — дублируется в Telegram как sendPhoto с публичным URL', async () => {
		const chatId = 3006
		const admin = await connectWs(adminToken)
		await api('/telegram/webhook', callback(chatId, 'start'))
		await api('/telegram/webhook', callback(chatId, 'lang:ru'))
		await api('/telegram/webhook', callback(chatId, 'cat:site'))
		registerFakeFile('f6')
		await api('/telegram/webhook', photoMessage(chatId, 'f6', 'вопрос с картинкой'))
		const conversation = await findConversationByChat(chatId)

		// используем уже сохранённый файл посетителя как вложение ответа оператора —
		// проще, чем поднимать ещё один multipart-запрос; нас интересует сам relay
		const visitorMsg = await admin.waitFor(m => m.attachmentUrl)

		admin.send({
			conversationId: conversation!.id,
			text: 'вот ответ',
			attachmentUrl: visitorMsg.attachmentUrl,
			attachmentType: visitorMsg.attachmentType,
			attachmentSize: visitorMsg.attachmentSize
		})
		await admin.waitFor(m => m.type === 'sent')

		const sentPhoto = photos.find(p => p.chatId === String(chatId))
		expect(sentPhoto).toMatchObject({
			photoUrl: `http://test-api.local${visitorMsg.attachmentUrl}`,
			caption: 'вот ответ'
		})

		admin.close()
	})
})

describe('Telegram-бот: прочее', () => {
	test('апдейт без текста и без callback_data (например, стикер) — просто 200, ничего не создаёт', async () => {
		const res = await api('/telegram/webhook', { method: 'POST', body: { message: { chat: { id: 9999 } } } })
		expect(res.status).toBe(200)
		expect(await findConversationByChat(9999)).toBeUndefined()
	})
})
