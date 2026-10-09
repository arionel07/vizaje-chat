import { beforeAll, describe, expect, test } from 'bun:test'
import {
	addMessage,
	markConversationRead,
	updateConversationStatus
} from '../src/chat/service'
import { api, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let token: string
// A: два непрочитанных от посетителя; B: посетитель + ответ, прочитана;
// C: закрытая, есть непрочитанное; D: пустая
let A: number, B: number, C: number, D: number

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token

	A = (await makeVisitor()).conversationId
	B = (await makeVisitor()).conversationId
	C = (await makeVisitor()).conversationId
	D = (await makeVisitor()).conversationId

	await addMessage(C, 'visitor', 'вопрос C')
	await updateConversationStatus(C, 'closed')

	await addMessage(B, 'visitor', 'вопрос B')
	await addMessage(B, 'admin', 'ответ B')
	await markConversationRead(B)
	await sleep(5)

	await addMessage(A, 'visitor', 'вопрос A1')
	await addMessage(A, 'visitor', 'вопрос A2')
})

const list = async (qs = '') =>
	(await api(`/admin/conversations${qs}`, { token })).body as any[]

describe('список бесед', () => {
	test('сортировка по последней активности, превью и непрочитанные', async () => {
		const rows = await list()
		expect(rows.map(r => r.id)).toEqual([A, B, C, D].sort((x, y) => order(x) - order(y)))

		const a = rows.find(r => r.id === A)
		expect(a).toMatchObject({
			lastMessageText: 'вопрос A2',
			lastMessageSender: 'visitor',
			unreadCount: 2,
			status: 'open'
		})
		const b = rows.find(r => r.id === B)
		expect(b).toMatchObject({
			lastMessageText: 'ответ B',
			lastMessageSender: 'admin',
			unreadCount: 0
		})
		const d = rows.find(r => r.id === D)
		expect(d).toMatchObject({ lastMessageText: null, unreadCount: 0 })
	})

	test('фильтры status и unread', async () => {
		expect((await list('?status=closed')).map(r => r.id)).toEqual([C])
		expect((await list('?status=open')).map(r => r.id).sort()).toEqual(
			[A, B, D].sort()
		)
		const unread = (await list('?unread=true')).map(r => r.id).sort()
		expect(unread).toEqual([A, C].sort())
		expect((await list('?status=open&unread=true')).map(r => r.id)).toEqual([A])
	})

	test('пагинация limit/offset', async () => {
		const all = await list()
		const page1 = await list('?limit=2&offset=0')
		const page2 = await list('?limit=2&offset=2')
		expect(page1.map(r => r.id)).toEqual(all.slice(0, 2).map(r => r.id))
		expect(page2.map(r => r.id)).toEqual(all.slice(2, 4).map(r => r.id))
	})

	test('некорректный status → 422, без токена → 401', async () => {
		expect((await api('/admin/conversations?status=zzz', { token })).status).toBe(
			422
		)
		expect((await api('/admin/conversations')).status).toBe(401)
	})
})

describe('счётчики и прочитанность', () => {
	test('counts: открытые, закрытые, с непрочитанными', async () => {
		const res = await api('/admin/conversations/counts', { token })
		expect(res.body).toEqual({ open: 3, closed: 1, unread: 2, mine: 0 })
	})

	test('POST /read обнуляет непрочитанные, новое сообщение считается снова', async () => {
		const res = await api(`/admin/conversations/${A}/read`, {
			method: 'POST',
			token
		})
		expect(res.status).toBe(200)
		expect((await list()).find(r => r.id === A)?.unreadCount).toBe(0)

		await sleep(5)
		await addMessage(A, 'visitor', 'вопрос A3')
		expect((await list()).find(r => r.id === A)?.unreadCount).toBe(1)
	})

	test('/read: несуществующая беседа → 404, без токена → 401', async () => {
		expect(
			(await api('/admin/conversations/999999/read', { method: 'POST', token }))
				.status
		).toBe(404)
		expect(
			(await api(`/admin/conversations/${A}/read`, { method: 'POST' })).status
		).toBe(401)
	})
})

describe('сообщения и статус', () => {
	test('история беседы для админа с пагинацией', async () => {
		const res = await api(`/admin/conversations/${A}/messages?limit=2`, { token })
		expect(res.status).toBe(200)
		expect(res.body.map((m: any) => m.text)).toEqual(['вопрос A2', 'вопрос A3'])
	})

	test('PATCH status: закрытие пишет системное сообщение, значение проверяется', async () => {
		const closed = await api(`/admin/conversations/${D}/status`, {
			method: 'PATCH',
			token,
			body: { status: 'closed' }
		})
		expect(closed.status).toBe(200)
		expect(closed.body.status).toBe('closed')
		const msgs = await api(`/admin/conversations/${D}/messages`, { token })
		expect(msgs.body.at(-1)).toMatchObject({
			sender: 'system',
			text: 'Беседа закрыта'
		})

		const bad = await api(`/admin/conversations/${D}/status`, {
			method: 'PATCH',
			token,
			body: { status: 'archived' }
		})
		expect(bad.status).toBe(422)
	})
})

// порядок активности: по времени последнего сообщения (новые выше)
function order(id: number) {
	return { [A]: 0, [B]: 1, [C]: 2, [D]: 3 }[id]!
}
