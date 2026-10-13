import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createBotResponse } from '../src/bot-responses/service'
import { db } from '../src/db/client'
import { messages } from '../src/db/schema'
import { connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	await createBotResponse({
		triggerText: 'Сроки доставки',
		answerRu: 'Доставка занимает 2-3 дня',
		answerRo: 'Livrarea durează 2-3 zile'
	})
})

describe('автоответы бота', () => {
	test('точное совпадение триггера → бот отвечает сам, посетитель и админ получают ответ', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		visitor.send({ text: 'Сроки доставки' })

		const toVisitor = await visitor.waitFor(m => m.sender === 'bot')
		expect(toVisitor).toMatchObject({
			sender: 'bot',
			text: 'Доставка занимает 2-3 дня',
			conversationId: v.conversationId
		})
		await admin.waitFor(m => m.sender === 'bot' && m.text === 'Доставка занимает 2-3 дня')

		const rows = await db
			.select()
			.from(messages)
			.where(eq(messages.conversationId, v.conversationId))
		expect(rows.map(r => r.sender)).toEqual(['visitor', 'bot'])

		visitor.close()
		admin.close()
	})

	test('lang: ro → ответ на румынском', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)

		visitor.send({ text: 'Сроки доставки', lang: 'ro' })
		const got = await visitor.waitFor(m => m.sender === 'bot')
		expect(got.text).toBe('Livrarea durează 2-3 zile')

		visitor.close()
	})

	test('текст не совпадает с триггером → обычное сообщение, бот молчит', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		visitor.send({ text: 'Сроки доставки, но с хвостом' })
		await admin.waitFor(m => m.sender === 'visitor')
		await sleep(150)
		expect(visitor.messages.filter(m => m.sender === 'bot')).toHaveLength(0)
		expect(admin.messages.filter(m => m.sender === 'bot')).toHaveLength(0)

		visitor.close()
		admin.close()
	})

	test('сообщение от админа не запускает бота, даже если текст совпал с триггером', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		admin.send({ conversationId: v.conversationId, text: 'Сроки доставки' })
		await visitor.waitFor(m => m.sender === 'admin')
		await sleep(150)
		expect(visitor.messages.filter(m => m.sender === 'bot')).toHaveLength(0)

		visitor.close()
		admin.close()
	})
})
