import { beforeAll, describe, expect, test } from 'bun:test'
import { createBotResponse } from '../src/bot-responses/service'
import { addMessage, updateConversationStatus } from '../src/chat/service'
import { api, baseUrl, makeAdmin, makeVisitor, resetDb } from './helpers'

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

async function rawGet(path: string, token: string) {
	const res = await fetch(baseUrl() + path, {
		headers: { Authorization: `Bearer ${token}` }
	})
	return { res, text: await res.text() }
}

describe('GET /widget/export', () => {
	test('отдаёт историю текстом с заголовками для скачивания', async () => {
		const v = await makeVisitor()
		await addMessage(v.conversationId, 'visitor', 'Есть ли в наличии?')
		await addMessage(v.conversationId, 'admin', 'Да, есть в наличии')
		await addMessage(v.conversationId, 'bot', 'Автоматический ответ...')
		await updateConversationStatus(v.conversationId, 'closed')

		const { res, text } = await rawGet('/widget/export', v.token)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/plain')
		expect(res.headers.get('content-disposition')).toContain('attachment')
		expect(res.headers.get('content-disposition')).toContain(
			`conversation-${v.conversationId}.txt`
		)

		expect(text).toContain(`Беседа #${v.conversationId} — экспортировано`)
		expect(text).toContain('Посетитель: Есть ли в наличии?')
		expect(text).toContain('Оператор: Да, есть в наличии')
		expect(text).toContain('Бот: Автоматический ответ...')
		expect(text).toContain('--- Беседа закрыта ---')

		// хронологический порядок: вопрос раньше ответа оператора раньше закрытия
		const qIdx = text.indexOf('Есть ли в наличии?')
		const aIdx = text.indexOf('Да, есть в наличии')
		const closedIdx = text.indexOf('--- Беседа закрыта ---')
		expect(qIdx).toBeLessThan(aIdx)
		expect(aIdx).toBeLessThan(closedIdx)
	})

	test('без токена → 401', async () => {
		const res = await fetch(`${baseUrl()}/widget/export`)
		expect(res.status).toBe(401)
	})
})

describe('GET /admin/conversations/:id/export', () => {
	test('отдаёт ту же историю оператору по id беседы', async () => {
		const v = await makeVisitor()
		await addMessage(v.conversationId, 'visitor', 'Вопрос про возврат')

		const { res, text } = await rawGet(
			`/admin/conversations/${v.conversationId}/export`,
			adminToken
		)
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/plain')
		expect(text).toContain('Посетитель: Вопрос про возврат')
	})

	test('без токена → 401', async () => {
		const res = await fetch(`${baseUrl()}/admin/conversations/1/export`)
		expect(res.status).toBe(401)
	})

	test('несуществующая беседа → 404', async () => {
		const res = await api('/admin/conversations/999999/export', { token: adminToken })
		expect(res.status).toBe(404)
	})
})
