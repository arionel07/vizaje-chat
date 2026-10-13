import { beforeAll, describe, expect, test } from 'bun:test'
import { DEFAULT_SCHEDULE } from '../src/settings/service'
import { api, makeAdmin, resetDb } from './helpers'

let token: string

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

const allDays = (day: { enabled: boolean; start: string; end: string }) =>
	Object.fromEntries(DAYS.map(d => [d, day]))

const ALWAYS_ON = { days: allDays({ enabled: true, start: '00:00', end: '23:59' }) }
const ALWAYS_OFF = { days: allDays({ enabled: false, start: '09:00', end: '18:00' }) }

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token
})

describe('график работы: GET/PUT /admin/settings/schedule', () => {
	test('GET без токена → 401', async () => {
		expect((await api('/admin/settings/schedule')).status).toBe(401)
	})

	test('GET возвращает дефолтный график, пока свой не сохранён', async () => {
		const res = await api('/admin/settings/schedule', { token })
		expect(res.status).toBe(200)
		expect(res.body).toEqual(DEFAULT_SCHEDULE)
	})

	test('PUT сохраняет график, GET отдаёт сохранённый (таймзона всегда Europe/Chisinau)', async () => {
		const custom = {
			days: { ...DEFAULT_SCHEDULE.days, sat: { enabled: true, start: '10:00', end: '14:00' } }
		}
		const put = await api('/admin/settings/schedule', {
			method: 'PUT',
			token,
			body: custom
		})
		expect(put.status).toBe(200)
		expect(put.body).toEqual({
			timezone: 'Europe/Chisinau',
			days: { ...DEFAULT_SCHEDULE.days, sat: { enabled: true, start: '10:00', end: '14:00' } }
		})

		const get = await api('/admin/settings/schedule', { token })
		expect(get.body.days.sat).toEqual({ enabled: true, start: '10:00', end: '14:00' })
	})

	test('PUT без токена → 401', async () => {
		expect(
			(await api('/admin/settings/schedule', { method: 'PUT', body: ALWAYS_OFF })).status
		).toBe(401)
	})

	test('PUT с невалидным форматом времени → 422', async () => {
		const bad = {
			days: { ...DEFAULT_SCHEDULE.days, mon: { enabled: true, start: '9:00', end: '18:00' } }
		}
		expect(
			(await api('/admin/settings/schedule', { method: 'PUT', token, body: bad })).status
		).toBe(422)
	})

	test('PUT где начало позже конца включённого дня → 422', async () => {
		const bad = {
			days: { ...DEFAULT_SCHEDULE.days, mon: { enabled: true, start: '18:00', end: '09:00' } }
		}
		expect(
			(await api('/admin/settings/schedule', { method: 'PUT', token, body: bad })).status
		).toBe(422)
	})

	test('PUT без одного из дней → 422', async () => {
		const { sun: _sun, ...rest } = DEFAULT_SCHEDULE.days
		expect(
			(await api('/admin/settings/schedule', { method: 'PUT', token, body: { days: rest } }))
				.status
		).toBe(422)
	})
})

describe('GET /widget/status (публичный, без авторизации)', () => {
	test('отвечает без токена, форма ответа верная', async () => {
		const res = await api('/widget/status')
		expect(res.status).toBe(200)
		expect(typeof res.body.online).toBe('boolean')
		expect(res.body).toHaveProperty('nextOnlineAt')
		expect(typeof res.body.scheduleSummary).toBe('string')
	})

	test('график включён на все 24 часа — всегда online, nextOnlineAt: null', async () => {
		await api('/admin/settings/schedule', { method: 'PUT', token, body: ALWAYS_ON })
		const res = await api('/widget/status')
		expect(res.body).toMatchObject({ online: true, nextOnlineAt: null })
	})

	test('график выключен целиком — offline, nextOnlineAt: null (искать некуда)', async () => {
		await api('/admin/settings/schedule', { method: 'PUT', token, body: ALWAYS_OFF })
		const res = await api('/widget/status')
		expect(res.body).toEqual({ online: false, nextOnlineAt: null, scheduleSummary: '' })
	})
})
