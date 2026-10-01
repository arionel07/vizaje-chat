import { beforeAll, describe, expect, test } from 'bun:test'
import { api, makeAdmin, resetDb } from './helpers'

let token: string

beforeAll(async () => {
	await resetDb()
	token = (await makeAdmin()).token
})

describe('CRUD /admin/bot-responses', () => {
	test('список пуст, пока ничего не создано', async () => {
		const res = await api('/admin/bot-responses', { token })
		expect(res.status).toBe(200)
		expect(res.body).toEqual([])
	})

	test('без токена → 401 на всех методах', async () => {
		expect((await api('/admin/bot-responses')).status).toBe(401)
		expect(
			(
				await api('/admin/bot-responses', {
					method: 'POST',
					body: { triggerText: 't', answerRu: 'r', answerRo: 'o' }
				})
			).status
		).toBe(401)
		expect(
			(
				await api('/admin/bot-responses/1', {
					method: 'PATCH',
					body: { triggerText: 't' }
				})
			).status
		).toBe(401)
		expect((await api('/admin/bot-responses/1', { method: 'DELETE' })).status).toBe(401)
	})

	let createdId: number

	test('POST создаёт автоответ', async () => {
		const res = await api('/admin/bot-responses', {
			method: 'POST',
			token,
			body: {
				triggerText: 'Сроки доставки',
				answerRu: 'Доставка занимает 2-3 дня',
				answerRo: 'Livrarea durează 2-3 zile'
			}
		})
		expect(res.status).toBe(201)
		expect(res.body).toMatchObject({
			triggerText: 'Сроки доставки',
			answerRu: 'Доставка занимает 2-3 дня',
			answerRo: 'Livrarea durează 2-3 zile'
		})
		expect(res.body.id).toBeGreaterThan(0)
		createdId = res.body.id
	})

	test('POST с пустым полем → 422', async () => {
		expect(
			(
				await api('/admin/bot-responses', {
					method: 'POST',
					token,
					body: { triggerText: '  ', answerRu: 'x', answerRo: 'y' }
				})
			).status
		).toBe(422)
		expect(
			(
				await api('/admin/bot-responses', {
					method: 'POST',
					token,
					body: { triggerText: 'x', answerRu: '', answerRo: 'y' }
				})
			).status
		).toBe(422)
	})

	test('GET возвращает созданное, новые — сверху', async () => {
		await api('/admin/bot-responses', {
			method: 'POST',
			token,
			body: {
				triggerText: 'Есть ли в наличии?',
				answerRu: 'Да, уточняем на складе',
				answerRo: 'Da, verificăm stocul'
			}
		})
		const res = await api('/admin/bot-responses', { token })
		expect(res.status).toBe(200)
		expect(res.body.map((r: any) => r.triggerText)).toEqual([
			'Есть ли в наличии?',
			'Сроки доставки'
		])
	})

	test('PATCH обновляет только переданные поля', async () => {
		const res = await api(`/admin/bot-responses/${createdId}`, {
			method: 'PATCH',
			token,
			body: { answerRu: 'Доставка 1-2 дня' }
		})
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({
			id: createdId,
			triggerText: 'Сроки доставки', // не поменялось
			answerRu: 'Доставка 1-2 дня',
			answerRo: 'Livrarea durează 2-3 zile' // не поменялось
		})
	})

	test('PATCH с пустым полем → 422, ничего не сохраняется', async () => {
		const bad = await api(`/admin/bot-responses/${createdId}`, {
			method: 'PATCH',
			token,
			body: { triggerText: '' }
		})
		expect(bad.status).toBe(422)
		const get = await api('/admin/bot-responses', { token })
		expect(get.body.find((r: any) => r.id === createdId)?.triggerText).toBe(
			'Сроки доставки'
		)
	})

	test('PATCH несуществующего id → 404', async () => {
		expect(
			(
				await api('/admin/bot-responses/999999', {
					method: 'PATCH',
					token,
					body: { triggerText: 'x' }
				})
			).status
		).toBe(404)
	})

	test('DELETE удаляет автоответ, повторный DELETE → 404', async () => {
		const del = await api(`/admin/bot-responses/${createdId}`, {
			method: 'DELETE',
			token
		})
		expect(del.status).toBe(200)
		const list = await api('/admin/bot-responses', { token })
		expect(list.body.find((r: any) => r.id === createdId)).toBeUndefined()

		expect(
			(await api(`/admin/bot-responses/${createdId}`, { method: 'DELETE', token })).status
		).toBe(404)
	})
})
