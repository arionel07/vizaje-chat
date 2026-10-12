import { addMessage } from '../chat/service'
import { publishMessage } from '../chat/events'
import { allowVisitorMessage } from '../chat/rate-limit'
import {
	ASK_TEXT_PROMPT,
	BACK_LABEL,
	CATEGORY_LABELS,
	FAQ,
	GREETING,
	OTHER_QUESTION_LABEL,
	THANKS_FORWARDED,
	type CategoryId,
	type Lang
} from './menu'
import {
	type Button,
	answerTelegramCallback,
	clearTelegramKeyboard,
	getOrCreateConversationForChat,
	sendTelegramButtons,
	sendTelegramMessage
} from './service'
import { getChatState, setChatState } from './state'

const CATEGORY_IDS: CategoryId[] = ['retail', 'app', 'site', 'other']
// у 'other' нет своего FAQ — после выбора сразу просим написать вопрос,
// а не показываем пустой список с одной лишь кнопкой «Другой вопрос»
const CATEGORIES_WITHOUT_FAQ: CategoryId[] = ['other']

const withBack = (lang: Lang, rows: Button[][]): Button[][] => [
	...rows,
	[{ text: BACK_LABEL[lang], data: 'back' }]
]

async function showStart(chatId: string) {
	setChatState(chatId, { step: 'entry' })
	await sendTelegramButtons(chatId, 'Добро пожаловать! / Bun venit!', [
		[{ text: '▶️ Start', data: 'start' }]
	])
}

async function showLanguage(chatId: string) {
	setChatState(chatId, { step: 'lang' })
	await sendTelegramButtons(chatId, GREETING, [
		[
			{ text: '🇷🇺 Русский', data: 'lang:ru' },
			{ text: '🇷🇴 Română', data: 'lang:ro' }
		]
	])
}

async function showCategories(chatId: string, lang: Lang) {
	setChatState(chatId, { step: 'category', lang })
	const rows: Button[][] = CATEGORY_IDS.map(id => [
		{ text: CATEGORY_LABELS[id][lang], data: `cat:${id}` }
	])
	await sendTelegramButtons(
		chatId,
		lang === 'ru' ? 'Выберите тему:' : 'Alegeți subiectul:',
		withBack(lang, rows)
	)
}

async function showFaq(chatId: string, lang: Lang, categoryId: CategoryId) {
	setChatState(chatId, { step: 'faq', lang, categoryId })
	const questions = Object.keys(FAQ[categoryId][lang])
	const rows: Button[][] = questions.map((q, i) => [
		{ text: q, data: `faq:${categoryId}:${i}` }
	])
	rows.push([{ text: OTHER_QUESTION_LABEL[lang], data: `other:${categoryId}` }])
	await sendTelegramButtons(chatId, CATEGORY_LABELS[categoryId][lang], withBack(lang, rows))
}

async function promptFreeText(chatId: string, lang: Lang, categoryId: CategoryId) {
	setChatState(chatId, { step: 'support', lang, categoryId })
	await sendTelegramMessage(chatId, ASK_TEXT_PROMPT[lang])
}

// единственное место во всём меню, где заводится беседа в нашей БД —
// до этого момента ничего в админку не попадает (навигация и FAQ — чисто
// в Telegram, через sendTelegramMessage/Buttons, без addMessage)
async function forwardToAdmin(chatId: string, text: string) {
	const conversationId = await getOrCreateConversationForChat(chatId)
	if (!allowVisitorMessage(conversationId)) return
	const msg = await addMessage(conversationId, 'visitor', text)
	publishMessage(conversationId, msg)
}

export async function handleTelegramText(chatId: string, text: string) {
	const state = getChatState(chatId)
	if (state.step === 'support') {
		await forwardToAdmin(chatId, text)
		await sendTelegramMessage(chatId, THANKS_FORWARDED[state.lang ?? 'ru'])
		return
	}
	// любой текст вне «живого» общения с оператором (включая /start) —
	// начинаем/перезапускаем меню с кнопки Start
	await showStart(chatId)
}

export async function handleTelegramCallback(
	chatId: string,
	data: string,
	callbackQueryId: string,
	messageId?: number
) {
	// иначе кнопка в клиенте Telegram продолжает «крутиться» после нажатия
	await answerTelegramCallback(callbackQueryId)
	// снимаем клавиатуру с этого же сообщения — иначе она остаётся кликабельной
	// вечно, и нажатие на уже пройденный экран «отматывает» состояние назад
	if (messageId !== undefined) await clearTelegramKeyboard(chatId, messageId)
	const state = getChatState(chatId)

	if (data === 'start') return showLanguage(chatId)

	if (data.startsWith('lang:')) {
		return showCategories(chatId, data.slice(5) as Lang)
	}

	if (data.startsWith('cat:')) {
		const categoryId = data.slice(4) as CategoryId
		const lang = state.lang ?? 'ru'
		if (CATEGORIES_WITHOUT_FAQ.includes(categoryId)) {
			return promptFreeText(chatId, lang, categoryId)
		}
		return showFaq(chatId, lang, categoryId)
	}

	if (data.startsWith('faq:')) {
		const [, categoryId, indexStr] = data.split(':') as [string, CategoryId, string]
		const lang = state.lang ?? 'ru'
		const entry = Object.entries(FAQ[categoryId][lang])[Number(indexStr)]
		if (entry) await sendTelegramMessage(chatId, entry[1])
		return showFaq(chatId, lang, categoryId)
	}

	if (data.startsWith('other:')) {
		return promptFreeText(chatId, state.lang ?? 'ru', data.slice(6) as CategoryId)
	}

	if (data === 'back') {
		if (state.step === 'faq' && state.lang) return showCategories(chatId, state.lang)
		if (state.step === 'category') return showLanguage(chatId)
		return showStart(chatId)
	}
}
