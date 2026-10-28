import { beforeAll, describe, expect, test } from 'bun:test'
import jwt from 'jsonwebtoken'
import { addMessage, updateConversationAssignee } from '../src/chat/service'
import { api, makeAdmin, makeVisitor, resetDb } from './helpers'

let token: string
let adminId: number
// A: упоминание "заказ" в первом сообщении (давно), потом другая переписка;
// B: упоминание в последнем сообщении, назначена на меня; C: не совпадает ни с чем
let A: number, B: number, C: number
let sessionA: string

beforeAll(async () => {
	await resetDb()
	const admin = await makeAdmin()
	token = admin.token
	adminId = admin.admin.id

	const visitorA = await makeVisitor()
	A = visitorA.conversationId
	// createSession() не возвращает sessionId напрямую — достаём его из токена посетителя
	sessionA = (jwt.decode(visitorA.token) as { sessionId: string }).sessionId
	B = (await makeVisitor()).conversationId
	C = (await makeVisitor()).conversationId

	// совпадение — в самом первом сообщении беседы, а не только в последнем:
	// поиск обязан смотреть по всей истории, не только по превью
	await addMessage(A, 'visitor', 'Здравствуйте, вопрос по ЗАКАЗУ №42')
	await addMessage(A, 'admin', 'Уточните, пожалуйста, номер телефона')
	await addMessage(A, 'visitor', 'Хорошо, сейчас напишу')

	await addMessage(B, 'visitor', 'Добрый день')
	await addMessage(B, 'admin', 'Здравствуйте! Чем помочь?')
	await addMessage(B, 'visitor', 'Когда доставят заказ?')
	await updateConversationAssignee(B, adminId)

	await addMessage(C, 'visitor', 'Есть ли скидки на 100% натуральную косметику?')
})

const list = async (qs: string) =>
	(await api(`/admin/conversations${qs}`, { token })).body as any[]

describe('поиск по беседам', () => {
	test('по тексту сообщения — регистронезависимо, по всей истории (не только превью)', async () => {
		const rows = await list('?q=заказ')
		expect(rows.map(r => r.id).sort()).toEqual([A, B].sort())
	})

	test('по sessionId беседы', async () => {
		const rows = await list(`?q=${sessionA}`)
		expect(rows.map(r => r.id)).toEqual([A])
	})

	test('частичное совпадение', async () => {
		expect((await list('?q=ЗАКА')).map(r => r.id).sort()).toEqual([A, B].sort())
	})

	test('без совпадений — пустой список, не ошибка', async () => {
		expect(await list('?q=несуществующий_текст_xyz')).toEqual([])
	})

	test('% и _ в запросе не работают как маска ILIKE', async () => {
		// "100%" в тексте беседы C — просто подстрока, а не powered LIKE-паттерн
		expect((await list('?q=100%')).map(r => r.id)).toEqual([C])
		expect(await list('?q=100%%')).toEqual([]) // такой подстроки нет
	})

	test('пустой q — как отсутствие фильтра', async () => {
		expect((await list('?q=')).length).toBe(3)
	})

	test('сочетается с assignee=me и status', async () => {
		expect((await list('?q=заказ&assignee=me')).map(r => r.id)).toEqual([B])
		expect((await list('?q=доставят&status=open')).map(r => r.id)).toEqual([B])
	})

	test('без токена → 401', async () => {
		expect((await api('/admin/conversations?q=заказ')).status).toBe(401)
	})
})
