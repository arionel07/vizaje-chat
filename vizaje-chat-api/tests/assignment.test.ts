import { beforeAll, describe, expect, test } from 'bun:test'
import { api, connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

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

	// assigneeId — быстрый переход к беседам конкретного коллеги из списка
	// операторов в сайдбаре, не только «мои» (не зависит от того, кто залогинен)
	test('assigneeId — беседы конкретного оператора, не обязательно текущего', async () => {
		const byAdmin = (
			await api(`/admin/conversations?assigneeId=${adminId}`, { token: otherToken })
		).body as any[]
		expect(byAdmin.map(c => c.id)).toEqual([A])

		const byOther = (
			await api(`/admin/conversations?assigneeId=${otherId}`, { token })
		).body as any[]
		expect(byOther).toEqual([])
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

describe('автоназначение по ответу оператора', () => {
	test('ответ в неназначенной беседе — закрепляет её за ответившим', async () => {
		const v = await makeVisitor()
		const admin = await connectWs(otherToken)
		admin.send({ conversationId: v.conversationId, text: 'Здравствуйте!' })
		await sleep(150)

		const res = await api(`/admin/conversations/${v.conversationId}/messages`, { token })
		const assignMsg = (res.body as any[]).find(
			m => m.sender === 'system' && String(m.text).includes('назначена')
		)
		expect(assignMsg?.text).toBe('Беседа назначена на other@test.io')

		const list = (await api(`/admin/conversations?assigneeId=${otherId}`, { token }))
			.body as any[]
		expect(list.map(c => c.id)).toContain(v.conversationId)

		admin.close()
	})

	test('беседа уже назначена — ответ другого оператора переназначает на него', async () => {
		const v = await makeVisitor()
		await api(`/admin/conversations/${v.conversationId}/assignee`, {
			method: 'PATCH',
			token,
			body: { assigneeId: adminId }
		})

		const admin = await connectWs(otherToken)
		admin.send({ conversationId: v.conversationId, text: 'Я подхвачу' })
		await sleep(150)

		const listOther = (await api(`/admin/conversations?assigneeId=${otherId}`, { token }))
			.body as any[]
		expect(listOther.map(c => c.id)).toContain(v.conversationId)
		const list = (await api(`/admin/conversations?assigneeId=${adminId}`, { token }))
			.body as any[]
		expect(list.map(c => c.id)).not.toContain(v.conversationId)

		admin.close()
	})

	test('тот же оператор отвечает повторно — назначение не меняется, лишнего сообщения нет', async () => {
		const v = await makeVisitor()
		const admin = await connectWs(otherToken)
		admin.send({ conversationId: v.conversationId, text: 'Первое' })
		await sleep(150)
		admin.send({ conversationId: v.conversationId, text: 'Второе' })
		await sleep(150)

		const msgs = (await api(`/admin/conversations/${v.conversationId}/messages`, { token }))
			.body as any[]
		const assignMsgs = msgs.filter(
			m => m.sender === 'system' && String(m.text).includes('назначена')
		)
		expect(assignMsgs).toHaveLength(1)

		admin.close()
	})
})

describe('видимость системного сообщения о назначении', () => {
	test('не видно посетителю (только оператору)', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		await api(`/admin/conversations/${v.conversationId}/assignee`, {
			method: 'PATCH',
			token,
			body: { assigneeId: otherId }
		})
		await sleep(150)
		expect(
			visitor.messages.some(m => m.sender === 'system' && String(m.text).includes('назначена'))
		).toBe(false)

		const msgs = (await api(`/admin/conversations/${v.conversationId}/messages`, { token }))
			.body as any[]
		expect(msgs.at(-1)).toMatchObject({ sender: 'system', text: 'Беседа назначена на other@test.io' })
		visitor.close()
	})
})
