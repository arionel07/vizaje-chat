import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, test } from 'bun:test'
import { addMessage, updateConversationAssignee, updateConversationStatus } from '../src/chat/service'
import { db } from '../src/db/client'
import { api, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let token: string
let aliceId: number, bobId: number

async function setCreatedAt(conversationId: number, iso: string) {
	await db.execute(
		sql`update conversations set created_at = ${iso}::timestamp where id = ${conversationId}`
	)
}

beforeAll(async () => {
	await resetDb()
	const alice = await makeAdmin('alice@test.io', 'correct-password')
	const bob = await makeAdmin('bob@test.io', 'correct-password')
	token = alice.token
	aliceId = alice.admin.id
	bobId = bob.admin.id
})

describe('GET /admin/analytics/overview', () => {
	let inRange: number, outOfRange: number, unanswered: number

	beforeAll(async () => {
		inRange = (await makeVisitor()).conversationId
		await addMessage(inRange, 'visitor', 'вопрос')
		await sleep(20)
		await addMessage(inRange, 'admin', 'ответ')
		await updateConversationStatus(inRange, 'closed')

		unanswered = (await makeVisitor()).conversationId
		await addMessage(unanswered, 'visitor', 'кто-нибудь есть?')

		outOfRange = (await makeVisitor()).conversationId
		await addMessage(outOfRange, 'visitor', 'старая беседа')
		await addMessage(outOfRange, 'admin', 'старый ответ')
		await setCreatedAt(outOfRange, '2020-01-01 10:00:00')
	})

	test('считает total/open/closed и среднее время первого ответа за период', async () => {
		const res = await api('/admin/analytics/overview?from=2025-01-01&to=2030-01-01', {
			token
		})
		expect(res.status).toBe(200)
		expect(res.body.total).toBe(2) // outOfRange не попадает (2020 год)
		expect(res.body.closed).toBe(1)
		expect(res.body.open).toBe(1)
		expect(res.body.respondedCount).toBe(1) // только inRange получил ответ админа
		expect(res.body.avgFirstResponseSeconds).toBeGreaterThanOrEqual(0)
		expect(res.body.avgFirstResponseSeconds).toBeLessThan(5)
	})

	test('узкий диапазон исключает старую беседу, широкий — включает', async () => {
		const narrow = await api('/admin/analytics/overview?from=2025-01-01&to=2030-01-01', {
			token
		})
		expect(narrow.body.total).toBe(2)

		const wide = await api('/admin/analytics/overview?from=2019-01-01&to=2030-01-01', {
			token
		})
		expect(wide.body.total).toBe(3)
	})

	test('без беседы с ответом — avgFirstResponseSeconds: null', async () => {
		const res = await api('/admin/analytics/overview?from=2029-01-01&to=2029-01-02', {
			token
		})
		expect(res.body).toEqual({
			total: 0,
			open: 0,
			closed: 0,
			avgFirstResponseSeconds: null,
			respondedCount: 0
		})
	})

	test('from позже to → 422, без токена → 401', async () => {
		expect(
			(await api('/admin/analytics/overview?from=2030-01-01&to=2020-01-01', { token }))
				.status
		).toBe(422)
		expect((await api('/admin/analytics/overview')).status).toBe(401)
	})
})

describe('GET /admin/analytics/timeline', () => {
	beforeAll(async () => {
		const a = (await makeVisitor()).conversationId
		await setCreatedAt(a, '2026-02-01 09:00:00')
		const b = (await makeVisitor()).conversationId
		await setCreatedAt(b, '2026-02-01 15:00:00') // тот же день, что и a
		const c = (await makeVisitor()).conversationId
		await setCreatedAt(c, '2026-02-03 09:00:00') // 2 февраля — пустой день между ними
	})

	test('группирует по дням, пустые дни — нулём', async () => {
		const res = await api('/admin/analytics/timeline?from=2026-02-01&to=2026-02-03', {
			token
		})
		expect(res.status).toBe(200)
		expect(res.body).toEqual([
			{ date: '2026-02-01', count: 2 },
			{ date: '2026-02-02', count: 0 },
			{ date: '2026-02-03', count: 1 }
		])
	})

	test('неподдерживаемая granularity → 422, без токена → 401', async () => {
		expect(
			(await api('/admin/analytics/timeline?granularity=week', { token })).status
		).toBe(422)
		expect((await api('/admin/analytics/timeline')).status).toBe(401)
	})
})

describe('GET /admin/analytics/operators', () => {
	beforeAll(async () => {
		const a = (await makeVisitor()).conversationId
		await setCreatedAt(a, '2026-03-01 10:00:00')
		await addMessage(a, 'visitor', 'вопрос A')
		await sleep(20)
		await addMessage(a, 'admin', 'ответ A')
		await updateConversationAssignee(a, aliceId)
		await updateConversationStatus(a, 'closed')

		const b = (await makeVisitor()).conversationId
		await setCreatedAt(b, '2026-03-02 10:00:00')
		await addMessage(b, 'visitor', 'вопрос B')
		await updateConversationAssignee(b, aliceId)
		// без ответа админа — не должна влиять на среднее alice, но должна на assigned
	})

	test('по каждому оператору: назначено/закрыто/среднее время ответа', async () => {
		const res = await api('/admin/analytics/operators?from=2026-03-01&to=2026-03-03', {
			token
		})
		expect(res.status).toBe(200)
		const alice = res.body.find((o: any) => o.id === aliceId)
		const bob = res.body.find((o: any) => o.id === bobId)
		expect(alice).toMatchObject({ email: 'alice@test.io', assigned: 2, closed: 1 })
		expect(alice.avgFirstResponseSeconds).toBeGreaterThanOrEqual(0)
		expect(alice.avgFirstResponseSeconds).toBeLessThan(5)
		// у bob за этот период нет назначенных бесед — нули, а не отсутствие в списке
		expect(bob).toMatchObject({
			email: 'bob@test.io',
			assigned: 0,
			closed: 0,
			avgFirstResponseSeconds: null
		})
	})

	test('без токена → 401', async () => {
		expect((await api('/admin/analytics/operators')).status).toBe(401)
	})
})
