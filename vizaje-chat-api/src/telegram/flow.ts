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
} from './menu'
import {
	type Button,
	answerTelegramCallback,
	clearTelegramKeyboard,
	downloadTelegramFile,
	getOrCreateConversationForChat,
	sendTelegramButtons,
	sendTelegramMessage,
	sessionIdForChat
} from './service'
import { getChatState, setChatState } from './state'

const CATEGORY_IDS: CategoryId[] = ['retail', 'app', 'site', 'other']

// Telegram сжимает фото всегда в JPEG и не даёт mime в объекте photo —
// угадываем по расширению в file_path, который возвращает getFile
const EXTENSION_MIME: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	avif: 'image/avif'
}
function guessMimeFromPath(path: string) {
	const ext = path.split('.').pop()?.toLowerCase()
	return ext ? EXTENSION_MIME[ext] : undefined
}

const UPLOAD_FAILED_TEXT: Record<Lang, string> = {
	ru: 'Не удалось загрузить изображение. Попробуйте ещё раз.',
	ro: 'Nu s-a putut încărca imaginea. Încercați din nou.'
}
const UNSUPPORTED_TYPE_TEXT: Record<Lang, string> = {
	ru: 'Поддерживаются только картинки: JPEG, PNG, WEBP, AVIF.',
	ro: 'Sunt acceptate doar imagini: JPEG, PNG, WEBP, AVIF.'
}

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

async function promptFreeText(chatId: string, lang: Lang, categoryId: CategoryId) {
	setChatState(chatId, { step: 'support', lang, categoryId })
	await sendTelegramButtons(chatId, ASK_TEXT_PROMPT[lang], withBack(lang, []))
}

// единственное место во всём меню, где заводится беседа в нашей БД —
// до этого момента ничего в админку не попадает (навигация и FAQ — чисто
// в Telegram, через sendTelegramMessage/Buttons, без addMessage)
async function forwardToAdmin(chatId: string, text: string, attachment?: Attachment | null) {
	const conversationId = await getOrCreateConversationForChat(chatId)
	if (!allowVisitorMessage(conversationId)) return
	const msg = await addMessage(conversationId, 'visitor', text, undefined, attachment)
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

// фото или картинка-документ — тот же путь, что и свободный текст: доходит
// до админа, только пока посетитель в режиме «напишите вопрос» (step: 'support').
// explicitMimeType — для документов (Telegram присылает mime_type), у сжатых
// фото его нет, mime угадывается по расширению в file_path (см. выше)
export async function handleTelegramPhoto(
	chatId: string,
	fileId: string,
	caption: string | undefined,
	explicitMimeType: string | undefined
) {
	const state = getChatState(chatId)
	if (state.step !== 'support') {
		// вне режима поддержки — как и с текстом, просто перезапускаем меню
		await showStart(chatId)
		return
	}
	const lang = state.lang ?? 'ru'

	if (!allowVisitorUpload(sessionIdForChat(chatId))) return

	const downloaded = await downloadTelegramFile(fileId)
	if (!downloaded) {
		await sendTelegramMessage(chatId, UPLOAD_FAILED_TEXT[lang])
		return
	}

	const mimeType =
		explicitMimeType && isAllowedMimeType(explicitMimeType)
			? explicitMimeType
			: guessMimeFromPath(downloaded.filePath)
	if (!mimeType || !isAllowedMimeType(mimeType)) {
		await sendTelegramMessage(chatId, UNSUPPORTED_TYPE_TEXT[lang])
		return
	}

	const filename = downloaded.filePath.split('/').pop() || 'photo.jpg'
	const file = new File([downloaded.buffer], filename, { type: mimeType })
	const result = await saveUpload(file)
	if (!result.ok) {
		await sendTelegramMessage(chatId, UPLOAD_FAILED_TEXT[lang])
		return
	}

	await forwardToAdmin(chatId, (caption ?? '').trim(), {
		url: result.upload.url,
		type: result.upload.type,
		name: result.upload.name,
		size: result.upload.size
	})
	await sendTelegramMessage(chatId, THANKS_FORWARDED[lang])
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
		return promptFreeText(chatId, state.lang ?? 'ru', categoryId)
	}

	if (data === 'back') {
		if (state.step === 'support' && state.lang) return showCategories(chatId, state.lang)
		if (state.step === 'category') return showLanguage(chatId)
		return showStart(chatId)
	}
}
