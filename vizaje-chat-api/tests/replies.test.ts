import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addMessage } from '../src/chat/service'
import { db } from '../src/db/client'
import { messages } from '../src/db/schema'
import { api, connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

const count = async (conversationId: number) =>
	(await db.select().from(messages).where(eq(messages.conversationId, conversationId)))
		.length

describe('ответ на сообщение через WS', () => {
	test('посетитель отвечает оператору: цитата в рассылке, подтверждении и истории', async () => {
		const v = await makeVisitor()
		const original = await addMessage(v.conversationId, 'admin', 'Ваш заказ отправлен')
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		visitor.send({ text: 'Когда придёт?', replyToId: original.id, clientId: 'r1' })

		const got = await admin.waitFor(m => m.text === 'Когда придёт?')
		expect(got.replyToId).toBe(original.id)
		expect(got.replyTo).toEqual({ id: original.id, sender: 'admin', text: 'Ваш заказ отправлен' })

		const ack = await visitor.waitFor(m => m.type === 'sent' && m.clientId === 'r1')
		expect(ack.id).toBe(got.id)

		const history = await api('/widget/messages', { token: v.token })
		const stored = history.body.find((m: any) => m.id === got.id)
		expect(stored.replyTo).toEqual(got.replyTo)
		// обычные сообщения — без цитаты
		expect(history.body.find((m: any) => m.id === original.id).replyTo).toBeNull()
		visitor.close()
		admin.close()
	})

	test('оператор отвечает посетителю', async () => {
		const v = await makeVisitor()
		const q = await addMessage(v.conversationId, 'visitor', 'Есть в наличии?')
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		admin.send({
			conversationId: v.conversationId,
			text: 'Да, есть',
			replyToId: q.id,
			clientId: 'a1'
		})
		const got = await visitor.waitFor(m => m.text === 'Да, есть')
		expect(got.replyTo).toEqual({ id: q.id, sender: 'visitor', text: 'Есть в наличии?' })
		visitor.close()
		admin.close()
	})

	test('цитата обрезается до 200 символов, оригинал не меняется', async () => {
		const v = await makeVisitor()
		const long = await addMessage(v.conversationId, 'admin', 'я'.repeat(500))
		const reply = await addMessage(v.conversationId, 'visitor', 'ок', long.id)
		expect(reply.replyTo?.text).toHaveLength(200)

		const history = await api('/widget/messages', { token: v.token })
		expect(history.body.find((m: any) => m.id === long.id).text).toHaveLength(500)
		expect(history.body.find((m: any) => m.id === reply.id).replyTo.text).toHaveLength(200)
	})

	test('цитируется одно сообщение, без вложенных цепочек', async () => {
		const v = await makeVisitor()
		const a = await addMessage(v.conversationId, 'admin', 'A')
		const b = await addMessage(v.conversationId, 'visitor', 'B', a.id)
		const c = await addMessage(v.conversationId, 'admin', 'C', b.id)
		expect(c.replyTo).toEqual({ id: b.id, sender: 'visitor', text: 'B' })
	})

	test('исходное сообщение из старой страницы истории цитируется и на новой странице', async () => {
		const v = await makeVisitor()
		const first = await addMessage(v.conversationId, 'admin', 'самое первое')
		for (let i = 0; i < 60; i++) await addMessage(v.conversationId, 'visitor', `m${i}`)
		await addMessage(v.conversationId, 'admin', 'ответ на первое', first.id)

		const page = await api('/widget/messages?limit=50', { token: v.token })
		expect(page.body.some((m: any) => m.id === first.id)).toBe(false) // не на странице
		const reply = page.body.at(-1)
		expect(reply.replyTo).toEqual({ id: first.id, sender: 'admin', text: 'самое первое' })
	})
})

describe('проверки ответа', () => {
	test('нельзя ответить на сообщение чужой беседы: ошибка, ничего не сохраняется и не утекает', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		const secret = await addMessage(b.conversationId, 'admin', 'секрет беседы B')
		const visitorA = await connectWs(a.token)

		visitorA.send({ text: 'подсматриваю', replyToId: secret.id, clientId: 'x1' })
		const err = await visitorA.waitFor(m => m.type === 'error' && m.clientId === 'x1')
		expect(err.error).toBe('Reply target not found')
		await sleep(150)
		expect(await count(a.conversationId)).toBe(0)
		expect(JSON.stringify(visitorA.messages)).not.toContain('секрет беседы B')
		visitorA.close()
	})

	test('админ тоже не может цитировать сообщение из другой беседы', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		const other = await addMessage(b.conversationId, 'visitor', 'чужое')
		const admin = await connectWs(adminToken)
		admin.send({
			conversationId: a.conversationId,
			text: 'x',
			replyToId: other.id,
			clientId: 'y1'
		})
		const err = await admin.waitFor(m => m.type === 'error' && m.clientId === 'y1')
		expect(err.error).toBe('Reply target not found')
		expect(await count(a.conversationId)).toBe(0)
		admin.close()
	})

	test('несуществующее сообщение → ошибка; кривые значения → Invalid message', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		visitor.send({ text: 'x', replyToId: 999999, clientId: 'n1' })
		expect((await visitor.waitFor(m => m.clientId === 'n1')).error).toBe('Reply target not found')

		let i = 0
		for (const bad of ['5', 0, -1, 1.5, null, {}]) {
			const id = `bad${i++}`
			visitor.send({ text: 'x', replyToId: bad, clientId: id })
			const err = await visitor.waitFor(m => m.type === 'error' && m.clientId === id)
			expect(err.error, JSON.stringify(bad)).toBe('Invalid message')
		}
		expect(await count(v.conversationId)).toBe(0)
		visitor.close()
	})
})

describe('ответ через REST виджета', () => {
	test('работает, публикуется с цитатой', async () => {
		const v = await makeVisitor()
		const q = await addMessage(v.conversationId, 'admin', 'Уточните номер заказа')
		const admin = await connectWs(adminToken)

		const res = await api('/widget/messages', {
			method: 'POST',
			token: v.token,
			body: { text: '12345', replyToId: q.id }
		})
		expect(res.status).toBe(200)
		expect(res.body.replyTo).toEqual({ id: q.id, sender: 'admin', text: 'Уточните номер заказа' })
		const got = await admin.waitFor(m => m.text === '12345')
		expect(got.replyTo.id).toBe(q.id)
		admin.close()
	})

	test('чужое сообщение → 404, кривой id → 422', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		const other = await addMessage(b.conversationId, 'admin', 'чужое')
		const foreign = await api('/widget/messages', {
			method: 'POST',
			token: a.token,
			body: { text: 'x', replyToId: other.id }
		})
		expect(foreign.status).toBe(404)
		for (const bad of [0, 'abc', 1.5]) {
			const res = await api('/widget/messages', {
				method: 'POST',
				token: a.token,
				body: { text: 'x', replyToId: bad }
			})
			expect(res.status, JSON.stringify(bad)).toBe(422)
		}
		expect(await count(a.conversationId)).toBe(0)
	})
})
