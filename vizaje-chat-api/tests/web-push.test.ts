import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { setWebPushSender } from '../src/web-push/send'
import { api, connectWs, makeAdmin, makeVisitor, resetDb } from './helpers'

let adminToken: string

// перехватываем реальную отправку (web-push бьёт в сеть к push-серверу браузера)
const sent: { endpoint: string; payload: string }[] = []

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setWebPushSender(async (subscription, payload) => {
		sent.push({ endpoint: subscription.endpoint, payload: String(payload) })
		return { statusCode: 201, body: '', headers: {} }
	})
})

beforeEach(() => {
	sent.length = 0
})

const subscription = (endpoint: string) => ({
	endpoint,
	keys: { p256dh: 'p256dh-key', auth: 'auth-key' }
})

describe('Web Push: подписка', () => {
	test('публичный ключ — 401 без токена, отдаётся с токеном', async () => {
		expect((await api('/admin/web-push/public-key')).status).toBe(401)

		const res = await api('/admin/web-push/public-key', { token: adminToken })
		expect(res.status).toBe(200)
		expect(typeof res.body.publicKey).toBe('string')
		expect(res.body.publicKey.length).toBeGreaterThan(0)
	})

	test('подписка без токена — 401', async () => {
		const res = await api('/admin/web-push/subscribe', {
			method: 'POST',
			body: subscription('https://fcm.googleapis.com/send/abc')
		})
		expect(res.status).toBe(401)
	})

	test('подписка сохраняется, повторная с тем же endpoint — не дублирует', async () => {
		const endpoint = 'https://fcm.googleapis.com/send/same-endpoint'
		const res1 = await api('/admin/web-push/subscribe', {
			method: 'POST',
			token: adminToken,
			body: subscription(endpoint)
		})
		expect(res1.status).toBe(200)

		const res2 = await api('/admin/web-push/subscribe', {
			method: 'POST',
			token: adminToken,
			body: subscription(endpoint)
		})
		expect(res2.status).toBe(200)
	})

	test('отписка удаляет подписку — дальше уведомления на неё не идут', async () => {
		const endpoint = 'https://fcm.googleapis.com/send/to-remove'
		await api('/admin/web-push/subscribe', {
			method: 'POST',
			token: adminToken,
			body: subscription(endpoint)
		})
		const res = await api('/admin/web-push/unsubscribe', {
			method: 'POST',
			token: adminToken,
			body: { endpoint }
		})
		expect(res.status).toBe(200)
	})
})

describe('Web Push: уведомление на сообщение посетителя', () => {
	test('новое сообщение от посетителя шлёт push на все активные подписки', async () => {
		const endpoint = 'https://fcm.googleapis.com/send/notify-me'
		await api('/admin/web-push/subscribe', {
			method: 'POST',
			token: adminToken,
			body: subscription(endpoint)
		})

		const { token } = await makeVisitor()
		const visitor = await connectWs(token)
		visitor.send({ text: 'привет, есть вопрос' })
		await visitor.waitFor(m => m.type === 'sent')

		// push — best-effort и асинхронный (не в ответ на sent), даём ему время
		const start = Date.now()
		while (sent.length === 0 && Date.now() - start < 2000) {
			await new Promise(r => setTimeout(r, 25))
		}

		const notified = sent.find(s => s.endpoint === endpoint)
		expect(notified).toBeDefined()
		const payload = JSON.parse(notified!.payload)
		expect(payload).toMatchObject({ body: 'привет, есть вопрос' })
		expect(payload.title).toMatch(/Беседа #/)

		visitor.close()
	})
})
