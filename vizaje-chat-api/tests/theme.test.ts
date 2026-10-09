import { beforeAll, describe, expect, test } from 'bun:test'
import { api, makeAdmin, resetDb } from './helpers'

let token: string

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token
})

describe('тема виджета: GET/PUT /admin/settings/theme', () => {
	test('GET без токена → 401', async () => {
		expect((await api('/admin/settings/theme')).status).toBe(401)
	})

	test('GET возвращает classic, пока своя тема не сохранена', async () => {
		const res = await api('/admin/settings/theme', { token })
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ theme: 'classic' })
	})

	test('PUT сохраняет тему, GET отдаёт сохранённую', async () => {
		const put = await api('/admin/settings/theme', {
			method: 'PUT',
			token,
			body: { theme: 'winter' }
		})
		expect(put.status).toBe(200)
		expect(put.body).toEqual({ theme: 'winter' })

		const get = await api('/admin/settings/theme', { token })
		expect(get.body).toEqual({ theme: 'winter' })
	})

	test('PUT без токена → 401', async () => {
		expect(
			(await api('/admin/settings/theme', { method: 'PUT', body: { theme: 'classic' } }))
				.status
		).toBe(401)
	})

	test('PUT с неизвестной темой → 422, сохранённая тема не меняется', async () => {
		const bad = await api('/admin/settings/theme', {
			method: 'PUT',
			token,
			body: { theme: 'summer' }
		})
		expect(bad.status).toBe(422)

		const get = await api('/admin/settings/theme', { token })
		expect(get.body).toEqual({ theme: 'winter' })
	})
})

describe('GET /widget/config', () => {
	test('публичный, без токена', async () => {
		const res = await api('/widget/config')
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ theme: 'winter' })
	})

	test('отражает смену темы через /admin/settings/theme', async () => {
		await api('/admin/settings/theme', {
			method: 'PUT',
			token,
			body: { theme: 'classic' }
		})
		const res = await api('/widget/config')
		expect(res.body).toEqual({ theme: 'classic' })
	})
})
