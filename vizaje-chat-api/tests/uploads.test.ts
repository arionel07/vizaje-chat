import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { db } from '../src/db/client'
import { messages } from '../src/db/schema'
import { cleanupOldAttachments } from '../src/uploads/cleanup'
import {
	api,
	apiUpload,
	connectWs,
	makeAdmin,
	makeVisitor,
	resetDb,
	tinyPngFile
} from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

beforeEach(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

describe('загрузка файлов', () => {
	test('без токена — 401, и для посетителя, и для оператора', async () => {
		const visitorRes = await apiUpload('/widget/upload', { file: tinyPngFile() })
		expect(visitorRes.status).toBe(401)

		const adminRes = await apiUpload('/admin/upload', { file: tinyPngFile() })
		expect(adminRes.status).toBe(401)
	})

	test('посетитель загружает картинку — файл сохраняется, отдаётся обратно по url', async () => {
		const { token } = await makeVisitor()
		const res = await apiUpload('/widget/upload', { token, file: tinyPngFile('cat.png') })

		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ type: 'image/png', name: 'cat.png' })
		expect(res.body.url).toMatch(/^\/uploads\/[\w-]+\.png$/)
		expect(res.body.size).toBeGreaterThan(0)

		const file = await api(res.body.url)
		expect(file.status).toBe(200)
	})

	test('оператор загружает картинку — тот же эндпоинт, тот же формат ответа', async () => {
		const res = await apiUpload('/admin/upload', { token: adminToken, file: tinyPngFile() })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ type: 'image/png' })
	})

	test('неподдерживаемый тип файла — 422, на диск не пишется', async () => {
		const { token } = await makeVisitor()
		const file = new File(['not an image'], 'evil.txt', { type: 'text/plain' })
		const res = await apiUpload('/widget/upload', { token, file })
		expect(res.status).toBe(422)
	})

	test('несуществующий файл по /uploads/:filename — 404', async () => {
		const res = await api('/uploads/does-not-exist.png')
		expect(res.status).toBe(404)
	})

	test('попытка выйти за пределы папки через имя файла — 404, не 500', async () => {
		const res = await api('/uploads/..%2F..%2Fpackage.json')
		expect(res.status).toBe(404)
	})
})

describe('сообщение с вложением', () => {
	test('посетитель: загрузка + WS-сообщение с attachmentUrl — приходит админу с вложением', async () => {
		const { token } = await makeVisitor()
		const admin = await connectWs(adminToken)
		const visitor = await connectWs(token)

		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body

		visitor.send({
			text: '',
			attachmentUrl: uploaded.url,
			attachmentType: uploaded.type,
			attachmentName: uploaded.name,
			attachmentSize: uploaded.size
		})

		const got = await admin.waitFor(m => m.attachmentUrl === uploaded.url)
		expect(got).toMatchObject({
			sender: 'visitor',
			text: '',
			attachmentUrl: uploaded.url,
			attachmentType: 'image/png'
		})

		admin.close()
		visitor.close()
	})

	test('и текст, и вложение в одном сообщении — оба сохраняются', async () => {
		const { token } = await makeVisitor()
		const admin = await connectWs(adminToken)
		const visitor = await connectWs(token)
		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body

		visitor.send({ text: 'вот скриншот', attachmentUrl: uploaded.url, attachmentType: uploaded.type, attachmentSize: uploaded.size })

		const got = await admin.waitFor(m => m.attachmentUrl === uploaded.url)
		expect(got).toMatchObject({ text: 'вот скриншот', attachmentUrl: uploaded.url })

		admin.close()
		visitor.close()
	})

	test('ни текста, ни вложения — ошибка, сообщение не создаётся', async () => {
		const { token } = await makeVisitor()
		const visitor = await connectWs(token)
		visitor.send({ text: '' })
		const err = await visitor.waitFor(m => m.type === 'error')
		expect(err.error).toBe('Invalid message')
		visitor.close()
	})

	test('оператор: вложение в ответе доходит до посетителя', async () => {
		const { token, conversationId } = await makeVisitor()
		const visitor = await connectWs(token)
		const admin = await connectWs(adminToken)
		const uploaded = (await apiUpload('/admin/upload', { token: adminToken, file: tinyPngFile() })).body

		admin.send({ conversationId, text: '', attachmentUrl: uploaded.url, attachmentType: uploaded.type, attachmentSize: uploaded.size })

		const got = await visitor.waitFor(m => m.attachmentUrl === uploaded.url)
		expect(got).toMatchObject({ sender: 'admin', attachmentUrl: uploaded.url })

		admin.close()
		visitor.close()
	})

	test('REST /widget/messages тоже принимает вложение', async () => {
		const { token } = await makeVisitor()
		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body

		const res = await api('/widget/messages', {
			method: 'POST',
			token,
			body: {
				attachmentUrl: uploaded.url,
				attachmentType: uploaded.type,
				attachmentName: uploaded.name,
				attachmentSize: uploaded.size
			}
		})

		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ attachmentUrl: uploaded.url, text: '' })
	})

	test('подделанный attachmentUrl (не из /uploads/upload) — вложение отбрасывается, остаётся просто текст', async () => {
		const { token } = await makeVisitor()
		const res = await api('/widget/messages', {
			method: 'POST',
			token,
			body: { text: 'привет', attachmentUrl: '/etc/passwd', attachmentType: 'image/png', attachmentSize: 100 }
		})
		expect(res.status).toBe(200)
		expect(res.body.attachmentUrl).toBeNull()
		expect(res.body.text).toBe('привет')
	})
})

describe('очистка старых вложений', () => {
	test('вложение старше срока хранения — файл удаляется, поля сбрасываются, сообщение остаётся', async () => {
		const { token, conversationId } = await makeVisitor()
		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body

		const sendRes = await api('/widget/messages', {
			method: 'POST',
			token,
			body: { text: 'старое фото', attachmentUrl: uploaded.url, attachmentType: uploaded.type, attachmentSize: uploaded.size }
		})
		const messageId = sendRes.body.id

		// подделываем возраст сообщения — будто оно отправлено 10 дней назад
		await db
			.update(messages)
			.set({ createdAt: sql`now() - interval '10 days'` })
			.where(eq(messages.id, messageId))

		const fileCheckBefore = await api(uploaded.url)
		expect(fileCheckBefore.status).toBe(200)

		const cleaned = await cleanupOldAttachments()
		expect(cleaned).toBeGreaterThanOrEqual(1)

		const fileCheckAfter = await api(uploaded.url)
		expect(fileCheckAfter.status).toBe(404)

		const [row] = await db.select().from(messages).where(eq(messages.id, messageId))
		expect(row).toMatchObject({
			text: 'старое фото',
			attachmentUrl: null,
			attachmentType: null,
			attachmentName: null,
			attachmentSize: null
		})
	})

	test('список бесед: lastMessageHasAttachment — true, когда последнее сообщение с картинкой', async () => {
		const { token, conversationId } = await makeVisitor()
		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body
		await api('/widget/messages', {
			method: 'POST',
			token,
			body: { attachmentUrl: uploaded.url, attachmentType: uploaded.type, attachmentSize: uploaded.size }
		})

		const rows = (await api('/admin/conversations', { token: adminToken })).body
		const row = rows.find((r: any) => r.id === conversationId)
		expect(row).toMatchObject({ lastMessageText: '', lastMessageHasAttachment: true })
	})

	test('свежее вложение — очистка не трогает', async () => {
		const { token } = await makeVisitor()
		const uploaded = (await apiUpload('/widget/upload', { token, file: tinyPngFile() })).body
		await api('/widget/messages', {
			method: 'POST',
			token,
			body: { attachmentUrl: uploaded.url, attachmentType: uploaded.type, attachmentSize: uploaded.size }
		})

		await cleanupOldAttachments()

		const fileCheck = await api(uploaded.url)
		expect(fileCheck.status).toBe(200)
	})
})
