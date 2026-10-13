import { beforeAll, describe, expect, test } from 'bun:test'
import jwt from 'jsonwebtoken'
import {
	ADMIN_EMAIL,
	ADMIN_PASSWORD,
	api,
	makeAdmin,
	makeVisitor,
	resetDb
} from './helpers'

let adminToken: string
let visitorToken: string

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	visitorToken = (await makeVisitor()).token
})

describe('логин', () => {
	test('верные данные → токен с type=admin', async () => {
		const res = await api('/admin/auth/login', {
			method: 'POST',
			body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
		})
		expect(res.status).toBe(200)
		const payload = jwt.decode(res.body.token) as Record<string, unknown>
		expect(payload.type).toBe('admin')
		expect(payload.email).toBe(ADMIN_EMAIL)
	})

	test('неверный пароль и неизвестный email → 401', async () => {
		const wrong = await api('/admin/auth/login', {
			method: 'POST',
			body: { email: ADMIN_EMAIL, password: 'nope' }
		})
		const unknown = await api('/admin/auth/login', {
			method: 'POST',
			body: { email: 'nobody@test.io', password: 'x' }
		})
		expect(wrong.status).toBe(401)
		expect(unknown.status).toBe(401)
	})
})

describe('разделение токенов по полю type', () => {
	test('токен посетителя не открывает admin-эндпоинты', async () => {
		for (const [method, path] of [
			['GET', '/admin/auth/me'],
			['GET', '/admin/conversations'],
			['GET', '/admin/conversations/counts'],
			['GET', '/admin/conversations/1/messages'],
			['POST', '/admin/conversations/1/read']
		] as const) {
			const res = await api(path, { method, token: visitorToken })
			expect(res.status, `${method} ${path}`).toBe(401)
		}
	})

	test('токен админа не работает как сессия виджета', async () => {
		const res = await api('/widget/messages', { token: adminToken })
		expect(res.status).toBe(401)
	})

	test('без токена и с мусорным токеном → 401', async () => {
		expect((await api('/admin/conversations')).status).toBe(401)
		expect(
			(await api('/admin/conversations', { token: 'garbage' })).status
		).toBe(401)
		expect((await api('/widget/messages')).status).toBe(401)
	})

	test('токен, подписанный чужим секретом, отклоняется', async () => {
		const forged = jwt.sign({ type: 'admin', sub: 1, email: 'x@x.io' }, 'other')
		expect((await api('/admin/conversations', { token: forged })).status).toBe(
			401
		)
	})

	test('валидный админский токен принимается', async () => {
		const res = await api('/admin/auth/me', { token: adminToken })
		expect(res.status).toBe(200)
		expect(res.body.email).toBe(ADMIN_EMAIL)
	})
})

// в конце файла: исчерпывает лимит попыток входа для этого процесса
describe('rate-limit входа', () => {
	test('больше 10 попыток с одного IP → 429', async () => {
		const statuses: number[] = []
		for (let i = 0; i < 14; i++) {
			const res = await api('/admin/auth/login', {
				method: 'POST',
				body: { email: ADMIN_EMAIL, password: 'wrong' }
			})
			statuses.push(res.status)
		}
		expect(statuses).toContain(429)
		// до лимита неверный пароль — обычный 401
		expect(statuses.filter(s => s === 401).length).toBeLessThanOrEqual(10)
	})
})
