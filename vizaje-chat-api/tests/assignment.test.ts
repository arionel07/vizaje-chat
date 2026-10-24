import { beforeAll, describe, expect, test } from 'bun:test'
import { api, makeAdmin, makeVisitor, resetDb } from './helpers'

let token: string, otherToken: string
let adminId: number, otherId: number
let A: number, B: number

beforeAll(async () => {
	await resetDb()
	const me = await makeAdmin('me@test.io', 'correct-password')
	const other = await makeAdmin('other@test.io', 'correct-password')
	token = me.token
	otherToken = other.token
	adminId = me.admin.id
	otherId = other.admin.id

	A = (await makeVisitor()).conversationId
	B = (await makeVisitor()).conversationId
})

describe('список операторов', () => {
	test('GET /admin/operators — id и email, по алфавиту', async () => {
		const res = await api('/admin/operators', { token })
		expect(res.status).toBe(200)
		expect(res.body).toEqual([
			{ id: adminId, email: 'me@test.io' },
			{ id: otherId, email: 'other@test.io' }
		])
	})

	test('без токена → 401', async () => {
		expect((await api('/admin/operators')).status).toBe(401)
	})
})

describe('назначение беседы', () => {
	test('назначить оператора: обновляет беседу и пишет системное сообщение', async () => {
		const res = await api(`/admin/conversations/${A}/assignee`, {
			method: 'PATCH',
			token,
			body: { assigneeId: otherId }
		})
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({
			id: A,
			assigneeId: otherId,
			assigneeEmail: 'other@test.io'
		})

		const msgs = (await api(`/admin/conversations/${A}/messages`, { token }))
			.body as any[]
		expect(msgs.at(-1)).toMatchObject({
			sender: 'system',
			text: 'Беседа назначена на other@test.io'
		})
	})

	test('снять назначение (assigneeId: null)', async () => {
		const res = await api(`/admin/conversations/${A}/assignee`, {
			method: 'PATCH',
			token,
			body: { assigneeId: null }
		})
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ id: A, assigneeId: null, assigneeEmail: null })

		const msgs = (await api(`/admin/conversations/${A}/messages`, { token }))
			.body as any[]
		expect(msgs.at(-1)).toMatchObject({
			sender: 'system',
			text: 'Назначение беседы снято'
		})
	})

	test('несуществующий оператор → 404, несуществующая беседа → 404, без токена → 401', async () => {
		expect(
			(
				await api(`/admin/conversations/${A}/assignee`, {
					method: 'PATCH',
					token,
					body: { assigneeId: 999999 }
				})
			).status
		).toBe(404)
		expect(
			(
				await api('/admin/conversations/999999/assignee', {
					method: 'PATCH',
					token,
					body: { assigneeId: otherId }
				})
			).status
		).toBe(404)
		expect(
			(
				await api(`/admin/conversations/${A}/assignee`, {
					method: 'PATCH',
					body: { assigneeId: otherId }
				})
			).status
		).toBe(401)
	})
})

describe('фильтр assignee и счётчик mine', () => {
	test('assignee=me и assignee=unassigned', async () => {
		await api(`/admin/conversations/${A}/assignee`, {
			method: 'PATCH',
			token,
			body: { assigneeId: adminId }
		})
		// B остаётся без назначения

		const mine = (await api('/admin/conversations?assignee=me', { token }))
			.body as any[]
		expect(mine.map(c => c.id)).toEqual([A])

		const mineOther = (
			await api('/admin/conversations?assignee=me', { token: otherToken })
		).body as any[]
		expect(mineOther).toEqual([])

		const unassigned = (
			await api('/admin/conversations?assignee=unassigned', { token })
		).body as any[]
		expect(unassigned.map(c => c.id)).toEqual([B])
	})

	test('counts включает mine', async () => {
		const res = await api('/admin/conversations/counts', { token })
		expect(res.body).toMatchObject({ mine: 1 })

		const resOther = await api('/admin/conversations/counts', {
			token: otherToken
		})
		expect(resOther.body).toMatchObject({ mine: 0 })
	})
})
