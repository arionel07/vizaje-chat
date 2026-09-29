import { beforeAll, describe, expect, test } from 'bun:test'
import { addMessage } from '../src/chat/service'
import { api, connectWs, makeAdmin, makeVisitor, resetDb } from './helpers'

let adminToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
})

describe('сообщения через REST', () => {
	test('посетитель пишет, история отдаётся по порядку', async () => {
		const v = await makeVisitor()
		const post = await api('/widget/messages', {
			method: 'POST',
			token: v.token,
			body: { text: 'первое' }
		})
		expect(post.status).toBe(200)
		expect(post.body).toMatchObject({ sender: 'visitor', text: 'первое' })
		await api('/widget/messages', {
			method: 'POST',
			token: v.token,
			body: { text: 'второе' }
		})

		const history = await api('/widget/messages', { token: v.token })
		expect(history.status).toBe(200)
		expect(history.body.map((m: any) => m.text)).toEqual(['первое', 'второе'])
	})

	test('тело без text → 422', async () => {
		const v = await makeVisitor()
		const res = await api('/widget/messages', {
			method: 'POST',
			token: v.token,
			body: {}
		})
		expect(res.status).toBe(422)
	})

	test('посетитель видит только свою беседу', async () => {
		const a = await makeVisitor()
		const b = await makeVisitor()
		await addMessage(a.conversationId, 'visitor', 'секрет A')
		const res = await api('/widget/messages', { token: b.token })
		expect(res.body).toEqual([])
	})

	test('REST-сообщение публикуется в WS админам', async () => {
		const v = await makeVisitor()
		const admin = await connectWs(adminToken)
		await api('/widget/messages', {
			method: 'POST',
			token: v.token,
			body: { text: 'привет из REST' }
		})
		const got = await admin.waitFor(m => m.text === 'привет из REST')
		expect(got.conversationId).toBe(v.conversationId)
		admin.close()
	})

	test('лимит: не больше 5 сообщений за 10 секунд на беседу', async () => {
		const v = await makeVisitor()
		const statuses: number[] = []
		for (let i = 0; i < 7; i++) {
			const res = await api('/widget/messages', {
				method: 'POST',
				token: v.token,
				body: { text: `m${i}` }
			})
			statuses.push(res.status)
		}
		expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429])
	})
})

describe('пагинация истории', () => {
	test('limit, before и хронологический порядок', async () => {
		const v = await makeVisitor()
		for (let i = 1; i <= 60; i++) {
			await addMessage(v.conversationId, 'admin', `m${i}`)
		}

		const last = await api('/widget/messages?limit=50', { token: v.token })
		expect(last.body).toHaveLength(50)
		expect(last.body[0].text).toBe('m11')
		expect(last.body[49].text).toBe('m60')

		const older = await api(
			`/widget/messages?limit=50&before=${last.body[0].id}`,
			{ token: v.token }
		)
		expect(older.body.map((m: any) => m.text)).toEqual(
			Array.from({ length: 10 }, (_, i) => `m${i + 1}`)
		)

		// по умолчанию — 50, лимит зажат сверху
		const def = await api('/widget/messages', { token: v.token })
		expect(def.body).toHaveLength(50)
		const huge = await api('/widget/messages?limit=100000', { token: v.token })
		expect(huge.body).toHaveLength(60)
	})

	test('нечисловой limit → 422', async () => {
		const v = await makeVisitor()
		const res = await api('/widget/messages?limit=abc', { token: v.token })
		expect(res.status).toBe(422)
	})
})

// в конце файла: исчерпывает лимит создания сессий для этого процесса
describe('создание сессии', () => {
	test('POST /widget/session выдаёт токен и создаёт беседу', async () => {
		const res = await api('/widget/session', { method: 'POST' })
		expect(res.status).toBe(200)
		expect(typeof res.body.token).toBe('string')
		expect(typeof res.body.conversationId).toBe('number')
		const history = await api('/widget/messages', { token: res.body.token })
		expect(history.body).toEqual([])
	})

	test('больше 10 сессий в час с одного IP → 429', async () => {
		const statuses: number[] = []
		for (let i = 0; i < 14; i++) {
			statuses.push((await api('/widget/session', { method: 'POST' })).status)
		}
		expect(statuses).toContain(429)
		expect(statuses.filter(s => s === 200).length).toBeLessThanOrEqual(9)
	})
})
