import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/client'
import { conversations, messages } from '../src/db/schema'
import { addMessage } from '../src/chat/service'
import { api, connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

const countMessages = async (conversationId: number) =>
	(await db.select().from(messages).where(eq(messages.conversationId, conversationId)))
		.length

describe('обмен сообщениями', () => {
	test('админ пишет → посетитель и другая вкладка админа получают, отправитель — нет', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const tab1 = await connectWs(adminToken)
		const tab2 = await connectWs(adminToken)

		tab1.send({ conversationId: v.conversationId, text: '  привет  ' })

		const toVisitor = await visitor.waitFor(m => m.text === 'привет')
		expect(toVisitor).toMatchObject({
			sender: 'admin',
			conversationId: v.conversationId
		})
		await tab2.waitFor(m => m.text === 'привет')
		await sleep(150)
		expect(tab1.messages).toHaveLength(0) // ws.publish не шлёт отправителю
		expect(visitor.messages.filter(m => m.text === 'привет')).toHaveLength(1)

		;[visitor, tab1, tab2].forEach(c => c.close())
	})

	test('посетитель пишет → админ получает, сообщение сохранено', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		visitor.send({ text: 'вопрос' })
		const got = await admin.waitFor(m => m.text === 'вопрос')
		expect(got).toMatchObject({ sender: 'visitor', conversationId: v.conversationId })
		expect(await countMessages(v.conversationId)).toBe(1)

		visitor.close()
		admin.close()
	})
})

describe('валидация входящих сообщений', () => {
	test('пустой текст, не-объект, слишком длинный текст → ошибка с clientId, в БД ничего', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)

		visitor.send({ text: '   ', clientId: 'c1' })
		visitor.send({ text: 123, clientId: 'c2' })
		visitor.send({ text: 'x'.repeat(4001), clientId: 'c3' })
		visitor.send('это не JSON')

		for (const id of ['c1', 'c2', 'c3']) {
			const err = await visitor.waitFor(m => m.type === 'error' && m.clientId === id)
			expect(err.error).toBe('Invalid message')
		}
		await visitor.waitFor(m => m.type === 'error' && m.clientId === undefined)
		expect(await countMessages(v.conversationId)).toBe(0)
		visitor.close()
	})

	test('админ: несуществующая беседа и кривой conversationId', async () => {
		const admin = await connectWs(adminToken)
		admin.send({ conversationId: 999999, text: 'x', clientId: 'a1' })
		admin.send({ conversationId: '1', text: 'x', clientId: 'a2' })
		admin.send({ text: 'x', clientId: 'a3' })
		for (const id of ['a1', 'a2', 'a3']) {
			const err = await admin.waitFor(m => m.type === 'error' && m.clientId === id)
			expect(err.error).toBe('Conversation not found')
		}
		admin.close()
	})

	test('лимит посетителя: шестое сообщение отклонено, ошибка несёт его clientId', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		for (let i = 1; i <= 6; i++) visitor.send({ text: `m${i}`, clientId: `id${i}` })

		const err = await visitor.waitFor(m => m.type === 'error')
		expect(err).toMatchObject({ error: 'Too many messages', clientId: 'id6' })
		await sleep(150)
		expect(await countMessages(v.conversationId)).toBe(5)
		visitor.close()
	})
})

describe('статус беседы в реальном времени', () => {
	test('закрытие через API: системное сообщение приходит обеим сторонам', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		await api(`/admin/conversations/${v.conversationId}/status`, {
			method: 'PATCH',
			token: adminToken,
			body: { status: 'closed' }
		})
		const isClosedMsg = (m: any) => m.sender === 'system' && m.text === 'Беседа закрыта'
		await visitor.waitFor(isClosedMsg)
		await admin.waitFor(isClosedMsg)

		visitor.close()
		admin.close()
	})

	test('посетитель пишет в закрытую беседу → она открывается заново', async () => {
		const v = await makeVisitor()
		await api(`/admin/conversations/${v.conversationId}/status`, {
			method: 'PATCH',
			token: adminToken,
			body: { status: 'closed' }
		})
		const admin = await connectWs(adminToken)
		const visitor = await connectWs(v.token)

		visitor.send({ text: 'ещё вопрос' })
		await admin.waitFor(m => m.sender === 'system' && m.text === 'Беседа открыта заново')
		await admin.waitFor(m => m.text === 'ещё вопрос')

		const [conv] = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, v.conversationId))
		expect(conv?.status).toBe('open')
		visitor.close()
		admin.close()
	})
})

describe('авторизация WS', () => {
	test('мусорный токен → соединение закрывается', async () => {
		const c = await connectWs('garbage')
		await sleep(300)
		expect(c.isClosed()).toBe(true)
	})

	test('подписанный чужим секретом токен → закрывается', async () => {
		const jwt = (await import('jsonwebtoken')).default
		const forged = jwt.sign({ type: 'admin', sub: 1, email: 'x@x.io' }, 'other')
		const c = await connectWs(forged)
		await sleep(300)
		expect(c.isClosed()).toBe(true)
	})

	test('посетитель не получает чужие беседы', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		const visitorB = await connectWs(b.token)
		await addMessage(a.conversationId, 'admin', 'только для A')
		const admin = await connectWs(adminToken)
		admin.send({ conversationId: a.conversationId, text: 'ответ для A' })
		await sleep(300)
		expect(visitorB.messages.filter(m => m.conversationId === a.conversationId)).toEqual([])
		visitorB.close()
		admin.close()
	})
})
