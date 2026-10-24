import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { conversations } from '../src/db/schema'
import {
	setInstagramFileDownloader,
	setInstagramPhotoSender,
	setInstagramQuickReplySender,
	setInstagramSender,
	type Button
} from '../src/instagram/service'
import { baseUrl, connectWs, makeAdmin, resetDb, TINY_PNG_BASE64 } from './helpers'

// должен совпадать с tests/setup.ts
const APP_SECRET = 'test-instagram-app-secret'

let adminToken: string

// перехватываем всё, что бот шлёт в Instagram — обычный текст и quick replies
const texts: { psid: string; text: string }[] = []
const quickReplies: { psid: string; text: string; buttons: Button[] }[] = []
const photos: { psid: string; photoUrl: string; caption?: string }[] = []
// url → содержимое, которое "скачает" подменённый downloadInstagramFile
const fakeInstagramFiles = new Map<string, { buffer: ArrayBuffer; contentType: string | null }>()

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setInstagramSender(async (psid, text) => {
		texts.push({ psid, text })
	})
	setInstagramQuickReplySender(async (psid, text, buttons) => {
		quickReplies.push({ psid, text, buttons })
	})
	setInstagramPhotoSender(async (psid, photoUrl, caption) => {
		photos.push({ psid, photoUrl, caption })
	})
	setInstagramFileDownloader(async url => fakeInstagramFiles.get(url) ?? null)
})

beforeEach(() => {
	texts.length = 0
	quickReplies.length = 0
	photos.length = 0
	fakeInstagramFiles.clear()
})

const pngBuffer = () => Uint8Array.from(atob(TINY_PNG_BASE64), c => c.charCodeAt(0)).buffer
const registerFakeFile = (url: string, contentType = 'image/png') =>
	fakeInstagramFiles.set(url, { buffer: pngBuffer(), contentType })

// Meta подписывает каждый POST на вебхук HMAC-SHA256 от сырого тела на App Secret
function signedPost(path: string, body: unknown) {
	const raw = JSON.stringify(body)
	const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`
	return fetch(baseUrl() + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
		body: raw
	}).then(async res => ({ status: res.status, body: await res.json().catch(() => undefined) }))
}

const messagingEvent = (psid: number, event: Record<string, unknown>) => ({
	object: 'instagram',
	entry: [{ id: 'ig-business-id', time: Date.now(), messaging: [{ sender: { id: String(psid) }, ...event }] }]
})

const message = (psid: number, text: string) =>
	messagingEvent(psid, { message: { mid: `m-${Date.now()}`, text } })
const quickReply = (psid: number, payload: string) =>
	messagingEvent(psid, { message: { mid: `m-${Date.now()}`, text: payload, quick_reply: { payload } } })
const photoMessage = (psid: number, url: string, caption?: string) =>
	messagingEvent(psid, {
		message: { mid: `m-${Date.now()}`, text: caption, attachments: [{ type: 'image', payload: { url } }] }
	})
const echoMessage = (psid: number, text: string) =>
	messagingEvent(psid, { message: { mid: `m-${Date.now()}`, text, is_echo: true } })

const lastQuickReplyPayloads = () => quickReplies.at(-1)!.buttons.map(b => b.payload)
const findConversationByChat = (psid: number) =>
	db
		.select()
		.from(conversations)
		.where(eq(conversations.instagramUserId, String(psid)))
		.then(rows => rows[0])

describe('Instagram: верификация вебхука', () => {
	test('GET с верным verify_token — возвращает challenge', async () => {
		const res = await fetch(
			`${baseUrl()}/instagram/webhook?hub.mode=subscribe&hub.verify_token=test-instagram-verify-token&hub.challenge=echo-me`
		)
		expect(res.status).toBe(200)
		expect(await res.text()).toBe('echo-me')
	})

	test('GET с неверным verify_token — 403', async () => {
		const res = await fetch(
			`${baseUrl()}/instagram/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=echo-me`
		)
		expect(res.status).toBe(403)
	})

	test('POST без подписи (или с неверной) — 401, ничего не обрабатывается', async () => {
		const res = await fetch(`${baseUrl()}/instagram/webhook`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(message(5001, 'привет'))
		})
		expect(res.status).toBe(401)
		expect(await findConversationByChat(5001)).toBeUndefined()
	})

	test('POST с верной подписью — принимается', async () => {
		const res = await signedPost('/instagram/webhook', message(5002, 'hi'))
		expect(res.status).toBe(200)
	})

	test('эхо собственного сообщения (is_echo) — игнорируется', async () => {
		const res = await signedPost('/instagram/webhook', echoMessage(5003, 'ответ оператора'))
		expect(res.status).toBe(200)
		expect(texts).toHaveLength(0)
		expect(quickReplies).toHaveLength(0)
	})
})

describe('Instagram: навигация по меню (ничего не попадает в админку)', () => {
	test('первое сообщение — сразу выбор языка (нет /start — не Telegram), беседу не заводит', async () => {
		await signedPost('/instagram/webhook', message(1001, 'привет'))

		expect(quickReplies).toHaveLength(1)
		expect(lastQuickReplyPayloads()).toEqual(['lang:ru', 'lang:ro'])
		expect(await findConversationByChat(1001)).toBeUndefined()
	})

	test('язык → категория — сразу просьба написать вопрос, беседу не заводит', async () => {
		const psid = 1002
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		expect(lastQuickReplyPayloads()).toEqual(['cat:retail', 'cat:app', 'cat:site', 'cat:other', 'back'])

		await signedPost('/instagram/webhook', quickReply(psid, 'cat:retail'))
		expect(lastQuickReplyPayloads()).toEqual(['back'])
		expect(texts).toHaveLength(0)

		expect(await findConversationByChat(psid)).toBeUndefined()
	})

	test('«Назад» возвращает на шаг выше', async () => {
		const psid = 1003
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:retail'))
		await signedPost('/instagram/webhook', quickReply(psid, 'back'))
		expect(lastQuickReplyPayloads()).toEqual(['cat:retail', 'cat:app', 'cat:site', 'cat:other', 'back'])
	})

	test('категория «Другое» ведёт себя так же — сразу просит написать вопрос', async () => {
		const psid = 1004
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:other'))

		expect(quickReplies).toHaveLength(3)
		expect(quickReplies.at(-1)?.text).toMatch(/опишите вашу проблему/i)
		expect(await findConversationByChat(psid)).toBeUndefined()
	})
})

describe('Instagram: свободный текст после выбора категории — единственный путь в админку', () => {
	test('после выбора категории свободный текст заводит беседу и приходит админу', async () => {
		const psid = 2001
		const admin = await connectWs(adminToken)

		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:app'))
		expect(await findConversationByChat(psid)).toBeUndefined()

		await signedPost('/instagram/webhook', message(psid, 'у меня завис экран'))

		const got = await admin.waitFor(m => m.text === 'у меня завис экран')
		expect(got).toMatchObject({ sender: 'visitor' })
		const conversation = await findConversationByChat(psid)
		expect(conversation).toMatchObject({ channel: 'instagram', instagramUserId: String(psid) })
		expect(got.conversationId).toBe(conversation!.id)
		expect(texts.at(-1)?.text).toMatch(/спасибо/i)

		admin.close()
	})

	test('тема беседы приходит оператору системным сообщением — один раз за заход, заново при новом обращении', async () => {
		const psid = 2002
		const admin = await connectWs(adminToken)

		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:app'))
		await signedPost('/instagram/webhook', message(psid, 'первое сообщение'))

		const categoryMsg = await admin.waitFor(m => m.sender === 'system')
		expect(categoryMsg.text).toBe('Тема: Приложение')

		const systemCountBefore = admin.messages.filter(m => m.sender === 'system').length
		await signedPost('/instagram/webhook', message(psid, 'второе сообщение'))
		await admin.waitFor(m => m.text === 'второе сообщение')
		expect(admin.messages.filter(m => m.sender === 'system').length).toBe(systemCountBefore)

		// новое обращение — другая категория — тема приходит заново
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:site'))
		await signedPost('/instagram/webhook', message(psid, 'новый вопрос'))

		const systemMessages = admin.messages.filter(m => m.sender === 'system')
		expect(systemMessages.at(-1)?.text).toBe('Тема: Сайт')
		expect(systemMessages).toHaveLength(2)

		admin.close()
	})

	test('ответ оператора дублируется в тот же Instagram-чат', async () => {
		const psid = 2003
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:retail'))
		await signedPost('/instagram/webhook', message(psid, 'вопрос из инстаграма'))
		const conversation = await findConversationByChat(psid)

		const admin = await connectWs(adminToken)
		admin.send({ conversationId: conversation!.id, text: 'ответ оператора' })
		await admin.waitFor(m => m.type === 'sent')
		admin.close()

		expect(texts).toContainEqual({ psid: String(psid), text: 'ответ оператора' })
	})
})

describe('Instagram: фото — доходит до админа, как и текст', () => {
	test('фото вне режима поддержки — игнорируется (перезапускает меню на выбор языка)', async () => {
		const psid = 3001
		registerFakeFile('https://scontent.cdninstagram.com/f1.jpg')
		await signedPost(
			'/instagram/webhook',
			photoMessage(psid, 'https://scontent.cdninstagram.com/f1.jpg')
		)

		expect(await findConversationByChat(psid)).toBeUndefined()
		expect(lastQuickReplyPayloads()).toEqual(['lang:ru', 'lang:ro'])
	})

	test('фото в режиме поддержки — скачивается, сохраняется, доходит до админа с подписью', async () => {
		const psid = 3002
		const admin = await connectWs(adminToken)
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:app'))

		registerFakeFile('https://scontent.cdninstagram.com/f2.jpg', 'image/jpeg')
		await signedPost(
			'/instagram/webhook',
			photoMessage(psid, 'https://scontent.cdninstagram.com/f2.jpg', 'вот скрин ошибки')
		)

		const got = await admin.waitFor(m => m.attachmentUrl)
		expect(got).toMatchObject({
			sender: 'visitor',
			text: 'вот скрин ошибки',
			attachmentType: 'image/jpeg'
		})
		expect(got.attachmentUrl).toMatch(/^\/uploads\/[\w-]+\.jpg$/)
		expect(texts.at(-1)?.text).toMatch(/спасибо/i)

		admin.close()
	})

	test('неподдерживаемый тип — отклоняется с понятным сообщением', async () => {
		const psid = 3003
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:site'))

		registerFakeFile('https://scontent.cdninstagram.com/doc.pdf', 'application/pdf')
		await signedPost(
			'/instagram/webhook',
			photoMessage(psid, 'https://scontent.cdninstagram.com/doc.pdf')
		)

		expect(texts.at(-1)?.text).toMatch(/поддерживаются только картинки/i)
		expect(await findConversationByChat(psid)).toBeUndefined()
	})

	test('скачать файл не удалось — сообщение об ошибке, беседа не заводится', async () => {
		const psid = 3004
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:site'))
		// не регистрируем URL — downloadInstagramFile вернёт null

		await signedPost(
			'/instagram/webhook',
			photoMessage(psid, 'https://scontent.cdninstagram.com/missing.jpg')
		)

		expect(texts.at(-1)?.text).toMatch(/не удалось загрузить/i)
		expect(await findConversationByChat(psid)).toBeUndefined()
	})

	test('ответ оператора с картинкой — дублируется в Instagram по публичному URL', async () => {
		const psid = 3005
		const admin = await connectWs(adminToken)
		await signedPost('/instagram/webhook', message(psid, 'start'))
		await signedPost('/instagram/webhook', quickReply(psid, 'lang:ru'))
		await signedPost('/instagram/webhook', quickReply(psid, 'cat:site'))
		registerFakeFile('https://scontent.cdninstagram.com/f6.jpg')
		await signedPost(
			'/instagram/webhook',
			photoMessage(psid, 'https://scontent.cdninstagram.com/f6.jpg', 'вопрос с картинкой')
		)
		const conversation = await findConversationByChat(psid)

		const visitorMsg = await admin.waitFor(m => m.attachmentUrl)
		admin.send({
			conversationId: conversation!.id,
			text: 'вот ответ',
			attachmentUrl: visitorMsg.attachmentUrl,
			attachmentType: visitorMsg.attachmentType,
			attachmentSize: visitorMsg.attachmentSize
		})
		await admin.waitFor(m => m.type === 'sent')

		const sentPhoto = photos.find(p => p.psid === String(psid))
		expect(sentPhoto).toMatchObject({
			photoUrl: `http://test-api.local${visitorMsg.attachmentUrl}`,
			caption: 'вот ответ'
		})

		admin.close()
	})
})
