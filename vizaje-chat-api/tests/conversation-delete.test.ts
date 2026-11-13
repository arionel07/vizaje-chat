import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { addMessage } from '../src/chat/service'
import { db } from '../src/db/client'
import { conversations, messages } from '../src/db/schema'
import { api, makeAdmin, makeVisitor, resetDb } from './helpers'

let token: string

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token
})

describe('удаление беседы — выключено по умолчанию', () => {
	test('выключено по умолчанию: DELETE → 403, беседа остаётся', async () => {
		const v = await makeVisitor()
		const res = await api(`/admin/conversations/${v.conversationId}`, {
			method: 'DELETE',
			token
		})
		expect(res.status).toBe(403)
		const rows = await db
			.select()
			.from(conversations)
			.where(eq(conversations.id, v.conversationId))
		expect(rows).toHaveLength(1)
	})

	test('после включения в настройках — удаляет беседу и её сообщения', async () => {
		const put = await api('/admin/settings/conversation-delete', {
			method: 'PUT',
			token,
			body: { enabled: true }
		})
		expect(put.body).toEqual({ enabled: true })

		const v = await makeVisitor()
		await addMessage(v.conversationId, 'visitor', 'привет')

		const res = await api(`/admin/conversations/${v.conversationId}`, {
			method: 'DELETE',
			token
		})
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })

		expect(
			await db.select().from(conversations).where(eq(conversations.id, v.conversationId))
		).toHaveLength(0)
		expect(
			await db.select().from(messages).where(eq(messages.conversationId, v.conversationId))
		).toHaveLength(0)
	})

	test('несуществующая беседа → 404', async () => {
		const res = await api('/admin/conversations/999999', { method: 'DELETE', token })
		expect(res.status).toBe(404)
	})

	test('без токена → 401', async () => {
		const v = await makeVisitor()
		const res = await api(`/admin/conversations/${v.conversationId}`, { method: 'DELETE' })
		expect(res.status).toBe(401)
	})
})
