import { beforeAll, describe, expect, test } from 'bun:test'
import { addMessage } from '../src/chat/service'
import { api, connectWs, makeAdmin, makeVisitor, resetDb } from './helpers'

let adminToken: string
let adminId: number
let adminEmail: string

beforeAll(async () => {
	await resetDb()
	const admin = await makeAdmin()
	adminToken = admin.token
	adminId = admin.admin.id
	adminEmail = admin.admin.email
})

async function makeMessage() {
	const { token: visitorToken, conversationId } = await makeVisitor()
	const msg = await addMessage(conversationId, 'visitor', 'привет')
	return { conversationId, messageId: msg.id, visitorToken }
}

describe('Реакции на сообщения (только операторы, ❤️ 👍 🔥 🙏)', () => {
	test('PUT без токена — 401', async () => {
		const { messageId } = await makeMessage()
		const res = await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			body: { emoji: '❤️' }
		})
		expect(res.status).toBe(401)
	})

	test('PUT с неподдерживаемым эмодзи — 422', async () => {
		const { messageId } = await makeMessage()
		const res = await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '😀' }
		})
		expect(res.status).toBe(422)
	})

	test('PUT на несуществующее сообщение — 404', async () => {
		const res = await api('/admin/messages/999999/reaction', {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '🔥' }
		})
		expect(res.status).toBe(404)
	})

	test('ставит реакцию, видно в истории сообщений, приходит по WS в admin:global', async () => {
		const { conversationId, messageId } = await makeMessage()
		const admin = await connectWs(adminToken)

		const put = await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '🔥' }
		})
		expect(put.status).toBe(200)

		const event = await admin.waitFor(m => m.type === 'reaction')
		expect(event).toMatchObject({ conversationId, messageId })
		expect(event.reactions).toEqual([{ emoji: '🔥', adminId, adminEmail }])

		const history = await api(
			`/admin/conversations/${conversationId}/messages`,
			{ token: adminToken }
		)
		const found = history.body.find((m: { id: number }) => m.id === messageId)
		expect(found.reactions).toEqual([{ emoji: '🔥', adminId, adminEmail }])

		admin.close()
	})

	test('повторная реакция тем же оператором заменяет прежнюю, не дублирует', async () => {
		const { conversationId, messageId } = await makeMessage()
		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '❤️' }
		})
		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '👍' }
		})

		const history = await api(
			`/admin/conversations/${conversationId}/messages`,
			{ token: adminToken }
		)
		const found = history.body.find((m: { id: number }) => m.id === messageId)
		expect(found.reactions).toEqual([{ emoji: '👍', adminId, adminEmail }])
	})

	test('DELETE снимает реакцию', async () => {
		const { conversationId, messageId } = await makeMessage()
		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '👍' }
		})
		const del = await api(`/admin/messages/${messageId}/reaction`, {
			method: 'DELETE',
			token: adminToken
		})
		expect(del.status).toBe(200)

		const history = await api(
			`/admin/conversations/${conversationId}/messages`,
			{ token: adminToken }
		)
		const found = history.body.find((m: { id: number }) => m.id === messageId)
		expect(found.reactions).toEqual([])
	})

	test('два разных оператора могут поставить разные реакции на одно сообщение', async () => {
		const { conversationId, messageId } = await makeMessage()
		const { admin: other, token: otherToken } = await makeAdmin(
			'second-reactor@test.local',
			'password123'
		)

		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '❤️' }
		})
		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: otherToken,
			body: { emoji: '🙏' }
		})

		const history = await api(
			`/admin/conversations/${conversationId}/messages`,
			{ token: adminToken }
		)
		const found = history.body.find((m: { id: number }) => m.id === messageId)
		expect(found.reactions).toHaveLength(2)
		expect(found.reactions).toContainEqual({ emoji: '❤️', adminId, adminEmail })
		expect(found.reactions).toContainEqual({
			emoji: '🙏',
			adminId: other.id,
			adminEmail: other.email
		})
	})

	test('/widget/messages не отдаёт поле reactions — посетитель их не видит', async () => {
		const { messageId, visitorToken } = await makeMessage()
		await api(`/admin/messages/${messageId}/reaction`, {
			method: 'PUT',
			token: adminToken,
			body: { emoji: '🔥' }
		})

		const res = await api('/widget/messages?limit=10', { token: visitorToken })
		expect(res.status).toBe(200)
		const found = res.body.find((m: { id: number }) => m.id === messageId)
		expect(found.reactions).toBeUndefined()
	})

	test('/admin/auth/me отдаёт id — нужен фронту, чтобы понимать свою реакцию', async () => {
		const res = await api('/admin/auth/me', { token: adminToken })
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ id: adminId, email: adminEmail })
	})
})
