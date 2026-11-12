import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { findRestrictedBrand } from '../src/ai-bot/restricted-brands'
import { generateBotReply } from '../src/ai-bot/service'
import { conversations, messages } from '../src/db/schema'
import { db } from '../src/db/client'
import { setDeepseekConfig, setDeepseekFetcher } from '../src/ai-bot/deepseek'
import { setProductSearchConfig, setProductSearchFetcher } from '../src/products/service'
import { api, connectWs, makeAdmin, makeVisitor, resetDb, sleep } from './helpers'

let adminToken: string

// каждый элемент — что "модель" отвечает на соответствующий по счёту запрос
// в рамках одного generateBotReply (0-индекс = первый ход)
function scriptedModel(turns: { toolCalls: { name: string; args: unknown }[] }[]) {
	let i = 0
	return async () => {
		const turn = turns[i] ?? turns[turns.length - 1]
		i++
		if (!turn) throw new Error('scriptedModel: empty turns')
		return new Response(
			JSON.stringify({
				choices: [
					{
						finish_reason: 'tool_calls',
						message: {
							role: 'assistant',
							content: null,
							tool_calls: turn.toolCalls.map((c, idx) => ({
								id: `call_${i}_${idx}`,
								type: 'function',
								function: { name: c.name, arguments: JSON.stringify(c.args) }
							}))
						}
					}
				]
			}),
			{ status: 200 }
		)
	}
}

const SKU_5403 = {
	SKU: '5403',
	GUID: '5403',
	barcode: '3614270129681',
	variant_barcodes: '',
	titleRU: 'Biotherm Aquasource Total Eye Revitalizer',
	titleRO: 'Biotherm Aquasource Total Eye Revitalizer',
	brand: 'Biotherm',
	image: 'x.jpg',
	uriRU: '5403',
	category_uriRU: 'uhod',
	has_variants: false,
	variant_skus: '',
	has_stock: 1
}

beforeAll(async () => {
	await resetDb()
	adminToken = (await makeAdmin()).token
	setProductSearchConfig({ host: 'http://meili.test', searchKey: 'key', index: 'idx' })
	setDeepseekConfig({ apiKey: 'test-key', baseUrl: 'http://deepseek.test', model: 'deepseek-chat' })
})

beforeEach(() => {
	setProductSearchFetcher(async () => new Response(JSON.stringify({ hits: [SKU_5403] }), { status: 200 }))
})

describe('findRestrictedBrand', () => {
	test('кириллица и латиница — оба находят бренд', () => {
		expect(findRestrictedBrand('а есть диор?')?.brand).toBe('Dior')
		expect(findRestrictedBrand('do you have dior cream')?.brand).toBe('Dior')
		expect(findRestrictedBrand('шанель есть?')?.brand).toBe('Chanel')
	})

	test('Chanel — 4 магазина, остальные — только MallDova', () => {
		expect(findRestrictedBrand('шанель')?.stores).toHaveLength(4)
		expect(findRestrictedBrand('кензо')?.stores).toHaveLength(1)
	})

	test('обычный товар — не найден', () => {
		expect(findRestrictedBrand('биотерм крем')).toBeNull()
	})
})

describe('generateBotReply — restricted-бренд', () => {
	test('Dior: хэндофф + adminOnly системное сообщение + aiHandedOff=true', async () => {
		const v = await makeVisitor()
		setDeepseekFetcher(
			scriptedModel([
				{ toolCalls: [{ name: 'search_product', args: { query: 'есть диор?' } }] },
				{
					toolCalls: [
						{ name: 'handoff_to_operator', args: { reasonSummary: 'Спрашивал про Dior' } },
						{
							name: 'respond_to_visitor',
							args: {
								reply: 'Dior не продаётся на сайте, только в Shopping MallDova. Передаю оператору.',
								actions: []
							}
						}
					]
				}
			])
		)
		const reply = await generateBotReply(v.conversationId, 'есть диор?', 'ru')
		expect(reply?.text).toContain('MallDova')

		const [conv] = await db.select().from(conversations).where(eq(conversations.id, v.conversationId))
		expect(conv?.aiHandedOff).toBe(true)

		const rows = await db.select().from(messages).where(eq(messages.conversationId, v.conversationId))
		const sysMsg = rows.find(r => r.sender === 'system')
		expect(sysMsg?.adminOnly).toBe(true)
		expect(sysMsg?.text).toContain('Dior')
	})
})

describe('generateBotReply — товар найден', () => {
	test('found:true → ответ с кнопками (send_text + open_url)', async () => {
		const v = await makeVisitor()
		setDeepseekFetcher(
			scriptedModel([
				{ toolCalls: [{ name: 'search_product', args: { query: 'биотерм крем' } }] },
				{
					toolCalls: [
						{
							name: 'respond_to_visitor',
							args: {
								reply: 'На сайте в наличии.',
								actions: [
									{ label: 'Узнать наличие в магазине', type: 'send_text', value: 'Да, в магазине' },
									{
										label: 'Перейти на страницу товара',
										type: 'open_url',
										value: 'https://vizaje-nica.com/ru/katalog/uhod/5403'
									}
								]
							}
						}
					]
				}
			])
		)
		const reply = await generateBotReply(v.conversationId, 'биотерм крем есть?', 'ru')
		expect(reply?.text).toBe('На сайте в наличии.')
		expect(reply?.actions).toEqual([
			{ label: 'Узнать наличие в магазине', type: 'send_text', value: 'Да, в магазине' },
			{
				label: 'Перейти на страницу товара',
				type: 'open_url',
				value: 'https://vizaje-nica.com/ru/katalog/uhod/5403'
			}
		])
	})
})

describe('generateBotReply — служебные случаи', () => {
	test('DeepSeek не настроен → null', async () => {
		const v = await makeVisitor()
		setDeepseekConfig({ apiKey: null })
		const reply = await generateBotReply(v.conversationId, 'привет', 'ru')
		expect(reply).toBeNull()
		setDeepseekConfig({ apiKey: 'test-key' })
	})

	test('модель не вызвала respond_to_visitor за все ходы → честный хэндофф-фоллбэк', async () => {
		const v = await makeVisitor()
		// каждый ход — просто поиск, respond_to_visitor так и не вызван
		setDeepseekFetcher(scriptedModel([{ toolCalls: [{ name: 'search_product', args: { query: 'x' } }] }]))
		const reply = await generateBotReply(v.conversationId, 'x', 'ru')
		expect(reply?.text).toContain('оператора')

		const [conv] = await db.select().from(conversations).where(eq(conversations.id, v.conversationId))
		expect(conv?.aiHandedOff).toBe(true)
	})

	test('ошибка сети DeepSeek → null, не падает', async () => {
		const v = await makeVisitor()
		setDeepseekFetcher(async () => {
			throw new Error('network down')
		})
		const reply = await generateBotReply(v.conversationId, 'привет', 'ru')
		expect(reply).toBeNull()
	})
})

describe('WS: ИИ-бот в реальном потоке сообщений', () => {
	test('посетитель пишет → бот отвечает с кнопками, видно и посетителю, и админу', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)
		setDeepseekFetcher(
			scriptedModel([
				{
					toolCalls: [
						{
							name: 'respond_to_visitor',
							args: { reply: 'Добрый день! Чем помочь?', actions: [] }
						}
					]
				}
			])
		)

		visitor.send({ text: 'привет' })
		const toVisitor = await visitor.waitFor(m => m.sender === 'bot')
		expect(toVisitor).toMatchObject({ sender: 'bot', text: 'Добрый день! Чем помочь?' })
		await admin.waitFor(m => m.sender === 'bot' && m.text === 'Добрый день! Чем помочь?')

		visitor.close()
		admin.close()
	})

	test('после хэндоффа бот больше не отвечает в этой беседе', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)

		setDeepseekFetcher(
			scriptedModel([
				{
					toolCalls: [
						{ name: 'handoff_to_operator', args: { reasonSummary: 'брак товара' } },
						{ name: 'respond_to_visitor', args: { reply: 'Извините, подключаю оператора.', actions: [] } }
					]
				}
			])
		)
		visitor.send({ text: 'товар сломан, хочу вернуть' })
		await visitor.waitFor(m => m.sender === 'bot')

		// второе сообщение — бот больше не должен отвечать (aiHandedOff=true)
		visitor.send({ text: 'ещё раз спрашиваю' })
		await sleep(200)
		expect(visitor.messages.filter(m => m.sender === 'bot')).toHaveLength(1)

		visitor.close()
	})

	test('сообщение от админа не запускает бота', async () => {
		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		const admin = await connectWs(adminToken)

		admin.send({ conversationId: v.conversationId, text: 'здравствуйте' })
		await visitor.waitFor(m => m.sender === 'admin')
		await sleep(150)
		expect(visitor.messages.filter(m => m.sender === 'bot')).toHaveLength(0)

		visitor.close()
		admin.close()
	})
})

describe('GET/PUT /admin/settings/ai-bot — общий выключатель', () => {
	test('по умолчанию включён, без токена — 401', async () => {
		const res = await api('/admin/settings/ai-bot')
		expect(res.status).toBe(401)

		const get = await api('/admin/settings/ai-bot', { token: adminToken })
		expect(get.body).toEqual({ enabled: true })
	})

	test('выключение немедленно останавливает ответы бота в потоке сообщений', async () => {
		const put = await api('/admin/settings/ai-bot', {
			method: 'PUT',
			token: adminToken,
			body: { enabled: false }
		})
		expect(put.body).toEqual({ enabled: false })

		const v = await makeVisitor()
		const visitor = await connectWs(v.token)
		setDeepseekFetcher(
			scriptedModel([
				{ toolCalls: [{ name: 'respond_to_visitor', args: { reply: 'не должно прийти', actions: [] } }] }
			])
		)
		visitor.send({ text: 'привет' })
		await sleep(300)
		expect(visitor.messages.filter(m => m.sender === 'bot')).toHaveLength(0)
		visitor.close()

		// возвращаем как было, чтобы не сломать порядок прочих тестов файла
		await api('/admin/settings/ai-bot', { method: 'PUT', token: adminToken, body: { enabled: true } })
	})
})

describe('вложение без текста/с текстом — сразу хэндофф, DeepSeek не дёргаем', () => {
	test('фото + подпись → хэндофф без единого обращения к DeepSeek', async () => {
		const v = await makeVisitor()
		let deepseekCalled = false
		setDeepseekFetcher(async () => {
			deepseekCalled = true
			throw new Error('не должен был вызваться')
		})

		const reply = await generateBotReply(v.conversationId, 'а есть такой товар?', 'ru', true)
		expect(deepseekCalled).toBe(false)
		expect(reply?.text).toContain('оператора')

		const [conv] = await db.select().from(conversations).where(eq(conversations.id, v.conversationId))
		expect(conv?.aiHandedOff).toBe(true)

		// восстанавливаем рабочий fetcher, чтобы не сломать следующие тесты файла
		setDeepseekFetcher(
			scriptedModel([{ toolCalls: [{ name: 'respond_to_visitor', args: { reply: 'ok', actions: [] } }] }])
		)
	})
})

describe('GET /admin/ai-bot/handoffs — журнал передач оператору', () => {
	test('без токена → 401; после хэндоффа беседа появляется в журнале', async () => {
		const unauth = await api('/admin/ai-bot/handoffs')
		expect(unauth.status).toBe(401)

		const v = await makeVisitor()
		const reply = await generateBotReply(v.conversationId, 'фото без текста', 'ru', true)
		expect(reply).not.toBeNull()

		const res = await api('/admin/ai-bot/handoffs', { token: adminToken })
		expect(res.status).toBe(200)
		const entry = res.body.find((h: { conversationId: number }) => h.conversationId === v.conversationId)
		expect(entry).toBeDefined()
		expect(entry.reason).toContain('фото')
	})
})

describe('GET /admin/conversations — включает aiHandedOff', () => {
	test('после хэндоффа у беседы aiHandedOff: true в списке', async () => {
		const v = await makeVisitor()
		await generateBotReply(v.conversationId, 'фото', 'ru', true)

		const res = await api('/admin/conversations', { token: adminToken })
		const conv = res.body.find((c: { id: number }) => c.id === v.conversationId)
		expect(conv?.aiHandedOff).toBe(true)
	})
})
