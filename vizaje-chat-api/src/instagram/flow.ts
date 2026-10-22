import { addMessage, type Attachment } from '../chat/service'
import { publishMessage } from '../chat/events'
import { allowVisitorMessage, allowVisitorUpload } from '../chat/rate-limit'
import { isAllowedMimeType, saveUpload } from '../uploads/service'
import {
	ASK_TEXT_PROMPT,
	BACK_LABEL,
	CATEGORY_LABELS,
	GREETING,
	THANKS_FORWARDED,
	type CategoryId,
	type Lang
} from '../channels/menu'
import { getChatState, setChatState } from '../channels/state'
import {
	type Button,
	downloadInstagramFile,
	getOrCreateConversationForChat,
	sendInstagramMessage,
	sendInstagramQuickReplies,
	sessionIdForChat
} from './service'

const CATEGORY_IDS: CategoryId[] = ['retail', 'app', 'site', 'other']

const UPLOAD_FAILED_TEXT: Record<Lang, string> = {
	ru: 'Не удалось загрузить изображение. Попробуйте ещё раз.',
	ro: 'Nu s-a putut încărca imaginea. Încercați din nou.'
}
const UNSUPPORTED_TYPE_TEXT: Record<Lang, string> = {
	ru: 'Поддерживаются только картинки: JPEG, PNG, WEBP, AVIF.',
	ro: 'Sunt acceptate doar imagini: JPEG, PNG, WEBP, AVIF.'
}

const withBack = (lang: Lang, buttons: Button[]): Button[] => [
	...buttons,
	{ text: BACK_LABEL[lang], payload: 'back' }
]

// у Instagram нет команды /start — первое же сообщение (текст или фото) от
// нового собеседника сразу открывает выбор языка, без промежуточного экрана
async function showLanguage(psid: string) {
	setChatState(sessionIdForChat(psid), { step: 'lang' })
	await sendInstagramQuickReplies(psid, GREETING, [
		{ text: '🇷🇺 Русский', payload: 'lang:ru' },
		{ text: '🇷🇴 Română', payload: 'lang:ro' }
	])
}

async function showCategories(psid: string, lang: Lang) {
	setChatState(sessionIdForChat(psid), { step: 'category', lang })
	const buttons: Button[] = CATEGORY_IDS.map(id => ({
		text: CATEGORY_LABELS[id][lang],
		payload: `cat:${id}`
	}))
	await sendInstagramQuickReplies(
		psid,
		lang === 'ru' ? 'Выберите тему:' : 'Alegeți subiectul:',
		withBack(lang, buttons)
	)
}

async function promptFreeText(psid: string, lang: Lang, categoryId: CategoryId) {
	setChatState(sessionIdForChat(psid), { step: 'support', lang, categoryId })
	await sendInstagramQuickReplies(psid, ASK_TEXT_PROMPT[lang], withBack(lang, []))
}

// единственное место во всём меню, где заводится беседа в нашей БД — до
// этого момента ничего в админку не попадает (навигация — чисто в Instagram,
// через sendInstagramMessage/QuickReplies, без addMessage)
async function forwardToAdmin(
	psid: string,
	text: string,
	categoryId: CategoryId | undefined,
	attachment?: Attachment | null
) {
	const conversationId = await getOrCreateConversationForChat(psid)
	if (!allowVisitorMessage(conversationId)) return

	// отдельным системным сообщением — тема, которую посетитель выбрал в
	// меню (см. тот же приём в telegram/flow.ts) — один раз за заход в режим
	// поддержки, заново при каждом новом прохождении меню
	const state = getChatState(sessionIdForChat(psid))
	if (categoryId && !state.categoryAnnounced) {
		const categoryMsg = await addMessage(
			conversationId,
			'system',
			`Тема: ${CATEGORY_LABELS[categoryId].ru}`
		)
		publishMessage(conversationId, categoryMsg)
		setChatState(sessionIdForChat(psid), { ...state, categoryAnnounced: true })
	}

	const msg = await addMessage(conversationId, 'visitor', text, undefined, attachment)
	publishMessage(conversationId, msg)
}

export async function handleInstagramText(psid: string, text: string) {
	const state = getChatState(sessionIdForChat(psid))
	if (state.step === 'support') {
		await forwardToAdmin(psid, text, state.categoryId)
		await sendInstagramMessage(psid, THANKS_FORWARDED[state.lang ?? 'ru'])
		return
	}
	// любой текст вне «живого» общения с оператором — начинаем/перезапускаем
	// меню с выбора языка (аналог showStart в Telegram, но без /start — тут
	// нет такой команды, первое сообщение сразу открывает меню)
	await showLanguage(psid)
}

// фото — тот же путь, что и свободный текст: доходит до админа, только пока
// посетитель в режиме «напишите вопрос» (step: 'support')
export async function handleInstagramPhoto(psid: string, attachmentUrl: string, caption: string | undefined) {
	const state = getChatState(sessionIdForChat(psid))
	if (state.step !== 'support') {
		await showLanguage(psid)
		return
	}
	const lang = state.lang ?? 'ru'

	if (!allowVisitorUpload(sessionIdForChat(psid))) return

	const downloaded = await downloadInstagramFile(attachmentUrl)
	if (!downloaded) {
		await sendInstagramMessage(psid, UPLOAD_FAILED_TEXT[lang])
		return
	}

	const mimeType = downloaded.contentType?.split(';')[0]?.trim()
	if (!mimeType || !isAllowedMimeType(mimeType)) {
		await sendInstagramMessage(psid, UNSUPPORTED_TYPE_TEXT[lang])
		return
	}

	const extension = mimeType.split('/')[1] || 'jpg'
	const filename = `photo.${extension}`
	const file = new File([downloaded.buffer], filename, { type: mimeType })
	const result = await saveUpload(file)
	if (!result.ok) {
		await sendInstagramMessage(psid, UPLOAD_FAILED_TEXT[lang])
		return
	}

	await forwardToAdmin(psid, (caption ?? '').trim(), state.categoryId, {
		url: result.upload.url,
		type: result.upload.type,
		name: result.upload.name,
		size: result.upload.size
	})
	await sendInstagramMessage(psid, THANKS_FORWARDED[lang])
}

// нажатие quick reply — пришло как обычное текстовое сообщение с полем
// message.quick_reply.payload (см. routes/instagram.routes.ts); клавиатуру
// снимать не нужно — Instagram сам прячет quick replies после ответа
export async function handleInstagramQuickReply(psid: string, payload: string) {
	const state = getChatState(sessionIdForChat(psid))

	if (payload.startsWith('lang:')) {
		return showCategories(psid, payload.slice(5) as Lang)
	}

	if (payload.startsWith('cat:')) {
		const categoryId = payload.slice(4) as CategoryId
		return promptFreeText(psid, state.lang ?? 'ru', categoryId)
	}

	if (payload === 'back') {
		if (state.step === 'support' && state.lang) return showCategories(psid, state.lang)
		if (state.step === 'category') return showLanguage(psid)
		return showLanguage(psid)
	}
}
