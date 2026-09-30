import { beforeAll, describe, expect, test } from 'bun:test'
import { api, makeAdmin, resetDb } from './helpers'

let token: string

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token
})

describe('CRUD /admin/canned-responses', () => {
	test('список пуст, пока ничего не создано', async () => {
		const res = await api('/admin/canned-responses', { token })
		expect(res.status).toBe(200)
		expect(res.body).toEqual([])
	})

	test('без токена → 401 на всех методах', async () => {
		expect((await api('/admin/canned-responses')).status).toBe(401)
		expect(
			(
				await api('/admin/canned-responses', {
					method: 'POST',
					body: { title: 't', textRu: 'r', textRo: 'o' }
				})
			).status
		).toBe(401)
		expect(
			(await api('/admin/canned-responses/1', { method: 'PATCH', body: { title: 't' } }))
				.status
		).toBe(401)
		expect((await api('/admin/canned-responses/1', { method: 'DELETE' })).status).toBe(
			401
		)
	})

	let createdId: number

	test('POST создаёт шаблон', async () => {
		const res = await api('/admin/canned-responses', {
			method: 'POST',
			token,
			body: { title: 'Приветствие', textRu: 'Здравствуйте!', textRo: 'Bună ziua!' }
		})
		expect(res.status).toBe(201)
		expect(res.body).toMatchObject({
			title: 'Приветствие',
			textRu: 'Здравствуйте!',
			textRo: 'Bună ziua!'
		})
		expect(res.body.id).toBeGreaterThan(0)
		createdId = res.body.id
	})

	test('POST с пустым полем → 422', async () => {
		expect(
			(
				await api('/admin/canned-responses', {
					method: 'POST',
					token,
					body: { title: '  ', textRu: 'x', textRo: 'y' }
				})
			).status
		).toBe(422)
		expect(
			(
				await api('/admin/canned-responses', {
					method: 'POST',
					token,
					body: { title: 'x', textRu: '', textRo: 'y' }
				})
			).status
		).toBe(422)
	})

	test('GET возвращает созданное, новые — сверху', async () => {
		await api('/admin/canned-responses', {
			method: 'POST',
			token,
			body: { title: 'Возврат', textRu: 'Оформим возврат', textRo: 'Facem returul' }
		})
		const res = await api('/admin/canned-responses', { token })
		expect(res.status).toBe(200)
		expect(res.body.map((r: any) => r.title)).toEqual(['Возврат', 'Приветствие'])
	})

	test('PATCH обновляет только переданные поля', async () => {
		const res = await api(`/admin/canned-responses/${createdId}`, {
			method: 'PATCH',
			token,
			body: { textRu: 'Здравствуйте, чем помочь?' }
		})
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({
			id: createdId,
			title: 'Приветствие', // не поменялось
			textRu: 'Здравствуйте, чем помочь?',
			textRo: 'Bună ziua!' // не поменялось
		})
	})

	test('PATCH с пустым полем → 422, ничего не сохраняется', async () => {
		const bad = await api(`/admin/canned-responses/${createdId}`, {
			method: 'PATCH',
			token,
			body: { title: '' }
		})
		expect(bad.status).toBe(422)
		const get = await api('/admin/canned-responses', { token })
		expect(get.body.find((r: any) => r.id === createdId)?.title).toBe('Приветствие')
	})

	test('PATCH несуществующего id → 404', async () => {
		expect(
			(
				await api('/admin/canned-responses/999999', {
					method: 'PATCH',
					token,
					body: { title: 'x' }
				})
			).status
		).toBe(404)
	})

	test('DELETE удаляет шаблон, повторный DELETE → 404', async () => {
		const del = await api(`/admin/canned-responses/${createdId}`, {
			method: 'DELETE',
			token
		})
		expect(del.status).toBe(200)
		const list = await api('/admin/canned-responses', { token })
		expect(list.body.find((r: any) => r.id === createdId)).toBeUndefined()

		expect(
			(await api(`/admin/canned-responses/${createdId}`, { method: 'DELETE', token }))
				.status
		).toBe(404)
	})
})
