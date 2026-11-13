import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { messages } from '../src/db/schema'
import { addMessage, markConversationRead } from '../src/chat/service'
import { api, connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

describe('подтверждение отправки (sent)', () => {
	test('отправитель получает серверные id и время своего сообщения', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		visitor.send({ text: 'привет', clientId: 'k1' })

		const ack = await visitor.waitFor(m => m.type === 'sent' && m.clientId === 'k1')
		const [row] = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, v.conversationId))
		expect(ack.id).toBe(row!.id)
		expect(ack.conversationId).toBe(v.conversationId)
		expect(new Date(ack.createdAt).getTime()).toBe(row!.createdAt.getTime())
		visitor.close()
	})

	test('админ тоже получает подтверждение', async () => {
		const v = await makeVisitor()
		const admin = await connectWs(adminToken)
		admin.send({ conversationId: v.conversationId, text: 'ответ', clientId: 'a1' })
		const ack = await admin.waitFor(m => m.type === 'sent' && m.clientId === 'a1')
		expect(typeof ack.id).toBe('number')
		admin.close()
	})

	test('отклонённое сообщение подтверждения не получает', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		visitor.send({ text: '   ', clientId: 'bad' })
		await visitor.waitFor(m => m.type === 'error' && m.clientId === 'bad')
		expect(visitor.messages.some(m => m.type === 'sent')).toBe(false)
		visitor.close()
	})
})

describe('«печатает»', () => {
	test('посетитель → админы; в БД ничего не пишется; отправитель не получает', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		visitor.send({ type: 'typing' })
		const ev = await admin.waitFor(m => m.type === 'typing')
		expect(ev).toEqual({
			type: 'typing',
			from: 'visitor',
			conversationId: v.conversationId
		})
		await sleep(150)
		expect(visitor.messages.filter(m => m.type === 'typing')).toHaveLength(0)
		expect(
			await db.select().from(messages).where(eq(messages.conversationId, v.conversationId))
		).toHaveLength(0)
		visitor.close()
		admin.close()
	})

	test('админ → посетитель этой беседы, не чужой', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		const visitorA = await connectWs(a.token)
		const visitorB = await connectWs(b.token)
		const admin = await connectWs(adminToken)

		admin.send({ type: 'typing', conversationId: a.conversationId })
		const ev = await visitorA.waitFor(m => m.type === 'typing')
		expect(ev).toEqual({ type: 'typing', from: 'admin', conversationId: a.conversationId })
		await sleep(150)
		expect(visitorB.messages.filter(m => m.type === 'typing')).toHaveLength(0)
		;[visitorA, visitorB, admin].forEach(c => c.close())
	})

	test('частые события ограничиваются: не больше одного в секунду', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)
		for (let i = 0; i < 10; i++) visitor.send({ type: 'typing' })
		await sleep(400)
		expect(admin.messages.filter(m => m.type === 'typing')).toHaveLength(1)
		visitor.close()
		admin.close()
	})

	test('админ с кривым conversationId не роняет соединение', async () => {
		const admin = await connectWs(adminToken)
		admin.send({ type: 'typing', conversationId: 'x' })
		admin.send({ type: 'typing' })
		await sleep(150)
		expect(admin.isClosed()).toBe(false)
		admin.close()
	})
})

describe('«Прочитано»', () => {
	test('оператор прочитал → посетитель получает событие и видит время в /widget/state', async () => {
		const v = await makeVisitor()
		await addMessage(v.conversationId, 'visitor', 'вопрос')
		const visitor = await connectWs(v.token)
		expect((await api('/widget/state', { token: v.token })).body).toEqual({
			adminLastReadAt: null
		})

		await api(`/admin/conversations/${v.conversationId}/read`, {
			method: 'POST',
			token: adminToken
		})
		const ev = await visitor.waitFor(m => m.type === 'read')
		expect(ev).toMatchObject({ by: 'admin', conversationId: v.conversationId })

		const state = await api('/widget/state', { token: v.token })
		expect(state.body.adminLastReadAt).toBe(ev.at)
		visitor.close()
	})

	test('посетитель прочитал → админы получают событие, время видно в списке бесед', async () => {
		const v = await makeVisitor()
		const admin = await connectWs(adminToken)

		const res = await api('/widget/read', { method: 'POST', token: v.token })
		expect(res.status).toBe(200)
		const ev = await admin.waitFor(m => m.type === 'read')
		expect(ev).toMatchObject({ by: 'visitor', conversationId: v.conversationId })

		const list = await api('/admin/conversations?limit=100', { token: adminToken })
		const row = list.body.find((c: any) => c.id === v.conversationId)
		expect(new Date(row.visitorLastReadAt).toISOString()).toBe(ev.at)
		admin.close()
	})

	test('/widget/read и /widget/state: без токена 401, токен админа не подходит', async () => {
		expect((await api('/widget/read', { method: 'POST' })).status).toBe(401)
		expect((await api('/widget/state')).status).toBe(401)
		expect((await api('/widget/read', { method: 'POST', token: adminToken })).status).toBe(401)
		expect((await api('/widget/state', { token: adminToken })).status).toBe(401)
	})

	test('отметка старше сообщения: сообщение после прочтения остаётся непрочитанным', async () => {
		const v = await makeVisitor()
		await api('/widget/read', { method: 'POST', token: v.token })
		await sleep(10)
		const late = await addMessage(v.conversationId, 'admin', 'позже')
		const list = await api('/admin/conversations?limit=100', {
			token: adminToken
		})
		const row = list.body.find((c: any) => c.id === v.conversationId)
		expect(new Date(row.visitorLastReadAt).getTime()).toBeLessThan(late.createdAt.getTime())
	})

	test('read-события не считаются сообщениями и не попадают в историю', async () => {
		const v = await makeVisitor()
		await api('/widget/read', { method: 'POST', token: v.token })
		await markConversationRead(v.conversationId)
		const history = await api('/widget/messages', { token: v.token })
		expect(history.body).toEqual([])
	})
})
