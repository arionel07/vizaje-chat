import { createHmac, timingSafeEqual } from 'crypto'
import { eq } from 'drizzle-orm'
import {
	INSTAGRAM_API_VERSION,
	INSTAGRAM_APP_SECRET,
	INSTAGRAM_PAGE_ACCESS_TOKEN
} from '../config'
import { db } from '../db/client'
import { conversations } from '../db/schema'

// sessionId у instagram-бесед синтетический (как и у telegram-бесед), но
// тоже уникален — переиспользуем ту же колонку/constraint, не заводя отдельную
export const sessionIdForChat = (psid: string) => `instagram:${psid}`

const GRAPH_URL = () => `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/me/messages`

type Sender = (psid: string, text: string) => Promise<unknown>

// настоящая отправка — вызов Graph API Send; подменяется в тестах через
// setInstagramSender, как publisher в chat/events.ts
let sender: Sender = async (psid, text) => {
	if (!INSTAGRAM_PAGE_ACCESS_TOKEN) {
		console.error('INSTAGRAM_PAGE_ACCESS_TOKEN не задан — сообщение в Instagram не отправлено')
		return
	}
	const res = await fetch(`${GRAPH_URL()}?access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ recipient: { id: psid }, message: { text } })
	})
	if (!res.ok) {
		console.error('Instagram send message failed:', res.status, await res.text().catch(() => ''))
	}
}

export function setInstagramSender(fn: Sender) {
	sender = fn
}

export async function sendInstagramMessage(psid: string, text: string) {
	await sender(psid, text)
}

export type Button = { text: string; payload: string }

type QuickReplySender = (psid: string, text: string, buttons: Button[]) => Promise<unknown>

// quick replies — горизontальный ряд кнопок под сообщением; в отличие от
// inline-кнопок Telegram, сам Instagram прячет их, как только собеседник
// на что-то ответил (текстом или другой quick reply) — свою версию
// clearTelegramKeyboard для них делать не нужно, платформа уже это умеет
let quickReplySender: QuickReplySender = async (psid, text, buttons) => {
	if (!INSTAGRAM_PAGE_ACCESS_TOKEN) {
		console.error('INSTAGRAM_PAGE_ACCESS_TOKEN не задан — сообщение в Instagram не отправлено')
		return
	}
	const res = await fetch(`${GRAPH_URL()}?access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			recipient: { id: psid },
			message: {
				text,
				quick_replies: buttons.map(b => ({
					content_type: 'text',
					title: b.text.slice(0, 20), // лимит Instagram — 20 символов
					payload: b.payload
				}))
			}
		})
	})
	if (!res.ok) {
		console.error(
			'Instagram send quick replies failed:',
			res.status,
			await res.text().catch(() => '')
		)
	}
}

export function setInstagramQuickReplySender(fn: QuickReplySender) {
	quickReplySender = fn
}

export async function sendInstagramQuickReplies(psid: string, text: string, buttons: Button[]) {
	await quickReplySender(psid, text, buttons)
}

type PhotoSender = (psid: string, photoUrl: string, caption?: string) => Promise<unknown>

// отправка картинки по публичной ссылке (сам Graph API её скачивает) —
// используется, когда оператор отвечает с вложением (см. ws.routes.ts).
// Нужен PUBLIC_API_URL (передаётся вызывающей стороной внутри photoUrl),
// иначе Instagram не сможет достучаться до нашего /uploads/....
// Send API не поддерживает подпись к картинке в одном сообщении — подпись,
// если есть, уходит отдельным текстовым сообщением перед картинкой
let photoSender: PhotoSender = async (psid, photoUrl, caption) => {
	if (!INSTAGRAM_PAGE_ACCESS_TOKEN) {
		console.error('INSTAGRAM_PAGE_ACCESS_TOKEN не задан — сообщение в Instagram не отправлено')
		return
	}
	if (caption) await sendInstagramMessage(psid, caption)
	const res = await fetch(`${GRAPH_URL()}?access_token=${INSTAGRAM_PAGE_ACCESS_TOKEN}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			recipient: { id: psid },
			message: { attachment: { type: 'image', payload: { url: photoUrl } } }
		})
	})
	if (!res.ok) {
		console.error('Instagram send photo failed:', res.status, await res.text().catch(() => ''))
	}
}

export function setInstagramPhotoSender(fn: PhotoSender) {
	photoSender = fn
}

export async function sendInstagramPhoto(psid: string, photoUrl: string, caption?: string) {
	await photoSender(psid, photoUrl, caption)
}

type FileDownloader = (
	url: string
) => Promise<{ buffer: ArrayBuffer; contentType: string | null } | null>

// скачивает картинку, которую посетитель прислал в Instagram — в отличие от
// Telegram это один шаг: вебхук сразу даёт публичный URL вложения
let fileDownloader: FileDownloader = async url => {
	const res = await fetch(url)
	if (!res.ok) {
		console.error('Instagram attachment download failed:', res.status)
		return null
	}
	return { buffer: await res.arrayBuffer(), contentType: res.headers.get('content-type') }
}

export function setInstagramFileDownloader(fn: FileDownloader) {
	fileDownloader = fn
}

export async function downloadInstagramFile(url: string) {
	return fileDownloader(url)
}

// подпись POST-запроса на вебхук (заголовок X-Hub-Signature-256) — HMAC-SHA256
// от сырого тела запроса на App Secret. Без INSTAGRAM_APP_SECRET проверка
// пропускается (тело просто не подписывается — см. routes/instagram.routes.ts)
export function verifyInstagramSignature(rawBody: string, signatureHeader: string | undefined) {
	if (!INSTAGRAM_APP_SECRET) return true
	if (!signatureHeader?.startsWith('sha256=')) return false
	const expected = createHmac('sha256', INSTAGRAM_APP_SECRET).update(rawBody).digest('hex')
	const given = signatureHeader.slice('sha256='.length)
	const expectedBuf = Buffer.from(expected, 'hex')
	const givenBuf = Buffer.from(given, 'hex')
	return expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf)
}

// идемпотентно: один psid — одна беседа, при повторном сообщении находим ту же
// (тот же приём, что и getOrCreateConversationId у виджета, см. widget/service.ts)
export async function getOrCreateConversationForChat(psid: string) {
	const sessionId = sessionIdForChat(psid)

	const [existing] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (existing) return existing.id

	const [inserted] = await db
		.insert(conversations)
		.values({ sessionId, channel: 'instagram', instagramUserId: psid })
		.onConflictDoNothing({ target: conversations.sessionId })
		.returning({ id: conversations.id })
	if (inserted) return inserted.id

	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	if (!row) throw new Error('Failed to get or create Instagram conversation')
	return row.id
}
