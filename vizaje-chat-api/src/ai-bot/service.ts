import { and, desc, eq, like } from 'drizzle-orm'
import type { MessageAction } from '../chat/service'
import { AI_HANDOFF_PREFIX, handoffConversationToOperator } from '../chat/service'
import { db } from '../db/client'
import { messages } from '../db/schema'
import { getSchedule, getStatus } from '../settings/service'
import { chatCompletion, isDeepseekConfigured, type ChatMessage, type ToolDef } from './deepseek'
import { runTool, TOOLS as SEARCH_AND_HANDOFF_TOOLS } from './tools'

// при передаче оператору вне рабочего графика — не делаем вид, что кто-то
// ответит прямо сейчас: честно и тепло объясняем, когда начнётся смена.
// Не полагаемся на то, что модель сама вспомнит график — считаем сами и
// дописываем к её ответу, раз handoff вообще случился
async function appendScheduleNoteIfOffline(text: string, lang: 'ru' | 'ro'): Promise<string> {
	const schedule = await getSchedule().catch(() => null)
	if (!schedule) return text
	const status = getStatus(schedule)
	if (status.online || !status.nextOnlineAt) return text
	const when = new Intl.DateTimeFormat(lang === 'ro' ? 'ro-RO' : 'ru-RU', {
		timeZone: 'Europe/Chisinau',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(status.nextOnlineAt))
	const note =
		lang === 'ro'
			? ` Chiar acum echipa este offline — un coleg vă răspunde la următoarea tură, ${when}. Mulțumim pentru răbdare! 💛`
			: ` Сейчас команда не онлайн — коллега ответит в начале следующей смены, ${when}. Спасибо, что подождёте! 💛`
	return `${text}${note}`
}

// финальный ответ посетителю отдаётся только через этот tool-call, не
// обычным текстом — так гарантированно получаем структуру (текст + кнопки),
// не полагаясь на response_format вместе с tools одновременно
const RESPOND_TOOL: ToolDef = {
	type: 'function',
	function: {
		name: 'respond_to_visitor',
		description:
			'Отправить финальный ответ посетителю в этом ходе. Всегда вызывай эту функцию, когда у тебя есть что ответить — не пиши ответ обычным текстом вне этой функции. Можно вызвать вместе с handoff_to_operator в одном ходе.',
		parameters: {
			type: 'object',
			properties: {
				reply: { type: 'string', description: 'Текст ответа посетителю' },
				lang: {
					type: 'string',
					enum: ['ru', 'ro'],
					description: 'Язык, на котором написан reply — тот же язык, что в последнем сообщении посетителя'
				},
				actions: {
					type: 'array',
					description:
						'Кнопки под ответом (обычно только после search_product с found:true). Пустой массив, если кнопки не нужны.',
					items: {
						type: 'object',
						properties: {
							label: { type: 'string' },
							type: { type: 'string', enum: ['send_text', 'open_url'] },
							value: {
								type: 'string',
								description:
									'Для send_text — текст, который отправится как сообщение от лица посетителя. Для open_url — ссылка на страницу товара.'
							}
						},
						required: ['label', 'type', 'value'],
						additionalProperties: false
					}
				}
			},
			required: ['reply', 'lang', 'actions'],
			additionalProperties: false
		}
	}
}

const TOOLS = [...SEARCH_AND_HANDOFF_TOOLS, RESPOND_TOOL]

const SYSTEM_PROMPT = (langName: string) => `Ты — вежливый ассистент поддержки интернет-магазина парфюмерии и косметики vizaje-nica.com. Отвечай на том языке, на котором посетитель написал своё ПОСЛЕДНЕЕ сообщение (русский или румынский) — определяй это сам по тексту, а не по тому, на каком языке сайт. Если по сообщению язык определить невозможно (оно слишком короткое, эмодзи, нет текста) — используй язык по умолчанию: ${langName}. Посетитель может в любой момент переключиться на другой язык — тогда переключись вместе с ним, без вопросов «на каком языке отвечать».

Правила:
1. Если речь о конкретном товаре/бренде (наличие, цена, варианты) — ВСЕГДА сначала вызови search_product. Никогда не отвечай по памяти о наличии или ассортименте.
2. Если search_product вернул restricted:true — бренд не продаётся на сайте по запрету бренда. Ответь тепло: назови бренд, скажи, что на сайте его нет, но он есть в магазине(ах) из ответа — укажи точное название и адрес КАЖДОГО магазина из списка. Спроси, какой именно товар бренда нужен, и сообщи, что передашь оператору, потому что у тебя нет возможности продать это онлайн. Затем вызови handoff_to_operator.
3. Если search_product вернул found:true — отвечай ТОЛЬКО через призму сайта, даже если посетитель не уточнял «сайт» или «магазин»: например «На сайте в наличии N шт.» или «На сайте сейчас нет в наличии». Никогда не говори расплывчато, без слова «сайт». К ответу через respond_to_visitor приложи actions: кнопку «Узнать наличие в магазине» (type: send_text, value — короткая фраза вроде «Да, хочу узнать наличие в магазине») и кнопку «Перейти на страницу товара» (type: open_url, value — url из ответа search_product).
4. Если found:false — товара нет в каталоге сайта, скажи это прямо, без выдумывания.
5. Если посетитель интересуется наличием именно в магазине (в т.ч. после клика по кнопке выше) — тепло ответь, что это уточнит оператор, и вызови handoff_to_operator.
6. Если посетитель жалуется на брак, возврат или проблему с заказом — НЕ пытайся решить сам. Сразу тепло извинись, скажи, что по этому вопросу ответит оператор, и вызови handoff_to_operator с кратким описанием проблемы в reasonSummary.
7. Если посетитель сам просит оператора/живого человека — подтверди тепло и вызови handoff_to_operator.
8. Если посетитель говорит, что твой ответ/найденный товар — не то, что он искал (например «нет, не то», «это не тот товар», «не подходит») — не гадай со второй попытки: извинись, что не угадал, и вызови handoff_to_operator с кратким описанием, что именно искал посетитель и чем твой ответ не подошёл.
9. Перед вызовом handoff_to_operator ВСЕГДА сначала скажи что-то тёплое и по делу в reply этого же хода — handoff не заменяет ответ, а дополняет его. Человек должен почувствовать, что его услышали, а не что его резко переключили.
10. Там, где уместно, заканчивай ответ коротким уточняющим вопросом — не обрывай разговор голым фактом.
11. Отвечай коротко и по-дружески, без канцелярита. Финальный ответ — только через respond_to_visitor, и в поле lang каждый раз честно укажи, на каком языке реально написан reply.`

export type BotReply = { text: string; actions: MessageAction[] }
// внутренний вариант с языком, который модель реально использовала для reply —
// нужен только внутри этого файла (appendScheduleNoteIfOffline), наружу
// (ws.routes.ts) язык ответа не нужен
type ParsedReply = BotReply & { lang: 'ru' | 'ro' }

const MAX_TOOL_ITERATIONS = 4

type ToolCall = { id: string; function: { name: string; arguments: string } }

function parseRespondArgs(raw: string): ParsedReply | null {
	try {
		const parsed = JSON.parse(raw) as { reply?: unknown; lang?: unknown; actions?: unknown }
		if (typeof parsed.reply !== 'string') return null
		const lang = parsed.lang === 'ro' ? 'ro' : 'ru'
		const actions = Array.isArray(parsed.actions)
			? parsed.actions.filter(
					(a): a is MessageAction =>
						a &&
						typeof a.label === 'string' &&
						(a.type === 'send_text' || a.type === 'open_url') &&
						typeof a.value === 'string'
				)
			: []
		return { text: parsed.reply, lang, actions }
	} catch {
		return null
	}
}

// null — ИИ не настроен или упал (сеть/ошибка DeepSeek): посетитель просто
// не получает автоответ и ждёт оператора, как было до этой фичи
// бот не видит вложения (фото/файл) — незачем гонять его по search_product
// вслепую на пустом тексте вроде «а такой есть?», впустую тратя ходы и деньги,
// раз всё равно закончится хэндоффом. Сразу передаём оператору
async function handoffForAttachment(conversationId: number, lang: 'ru' | 'ro'): Promise<BotReply> {
	await handoffConversationToOperator(
		conversationId,
		'Посетитель прислал фото/файл — ИИ не видит вложения, нужна ручная проверка'
	)
	const text =
		lang === 'ro'
			? 'Mulțumim pentru imagine! 📷 Din păcate, eu încă nu pot să văd poze — dar las-o aici, colegul meu se uită cu drag și vă ajută.'
			: 'Спасибо за картинку! 📷 Я, к сожалению, пока не умею их смотреть — но не переживайте, коллега обязательно посмотрит и поможет.'
	return { text: await appendScheduleNoteIfOffline(text, lang), actions: [] }
}

export async function generateBotReply(
	conversationId: number,
	visitorText: string,
	lang: 'ru' | 'ro',
	hasAttachment = false
): Promise<BotReply | null> {
	if (!isDeepseekConfigured()) return null
	if (hasAttachment) return handoffForAttachment(conversationId, lang)

	const langName = lang === 'ro' ? 'румынский (română)' : 'русский'
	const history: ChatMessage[] = [
		{ role: 'system', content: SYSTEM_PROMPT(langName) },
		{ role: 'user', content: visitorText }
	]

	try {
		for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
			const message = await chatCompletion(history, { tools: TOOLS })
			history.push({ role: 'assistant', content: message.content, tool_calls: message.tool_calls })

			const calls = (message.tool_calls ?? []) as ToolCall[]
			if (calls.length === 0) break // модель не вызвала ни одной функции — нечего отдать

			let finalReply: ParsedReply | null = null
			let handedOff = false
			for (const call of calls) {
				const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
				if (call.function.name === 'respond_to_visitor') {
					finalReply = parseRespondArgs(call.function.arguments)
					history.push({ role: 'tool', content: JSON.stringify({ ok: true }), tool_call_id: call.id })
					continue
				}
				if (call.function.name === 'handoff_to_operator') handedOff = true
				const result = await runTool(call.function.name, args, conversationId)
				history.push({ role: 'tool', content: result, tool_call_id: call.id })
			}
			if (finalReply) {
				// передача оператору вне рабочего графика — честно дописываем, когда
				// реально ответят, не полагаясь на то, что модель сама это учла.
				// Язык — тот, что реально использовала модель в reply, а не
				// language виджета по умолчанию (посетитель мог писать на другом)
				if (handedOff) {
					finalReply.text = await appendScheduleNoteIfOffline(finalReply.text, finalReply.lang)
				}
				return finalReply
			}
		}
	} catch (e) {
		console.error('AI bot error:', e)
		return null
	}

	// модель так и не ответила за отведённые ходы — не молчим, передаём
	// оператору сами, с честной пометкой, а не изображаем, что бот справился
	await handoffConversationToOperator(conversationId, 'ИИ не смог сформулировать ответ за отведённое число ходов')
	const text =
		lang === 'ro'
			? 'Hmm, aici am nevoie de ajutor uman 🙈 Chem imediat un coleg — vă ajută cu drag!'
			: 'Хм, тут мне нужна помощь человека 🙈 Уже зову коллегу — он обязательно поможет!'
	return { text: await appendScheduleNoteIfOffline(text, lang), actions: [] }
}

export type AiHandoff = { conversationId: number; reason: string; createdAt: Date }

const HANDOFF_LOG_LIMIT = 100

// журнал всех передач ИИ оператору (настройки админки) — чтобы было видно,
// на чём бот спотыкается, и можно было точечно поправить промпт/список
// брендов. Без отдельной таблицы: эти сообщения уже лежат в messages как
// adminOnly-системные (см. AI_HANDOFF_PREFIX в chat/service.ts)
export async function getRecentAiHandoffs(): Promise<AiHandoff[]> {
	const rows = await db
		.select({ conversationId: messages.conversationId, text: messages.text, createdAt: messages.createdAt })
		.from(messages)
		.where(and(eq(messages.sender, 'system'), like(messages.text, `${AI_HANDOFF_PREFIX}%`)))
		.orderBy(desc(messages.id))
		.limit(HANDOFF_LOG_LIMIT)
	return rows.map(r => ({
		conversationId: r.conversationId,
		reason: r.text.slice(AI_HANDOFF_PREFIX.length),
		createdAt: r.createdAt
	}))
}
