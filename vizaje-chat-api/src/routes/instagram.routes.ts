import { Elysia } from 'elysia'
import { INSTAGRAM_VERIFY_TOKEN } from '../config'
import {
	handleInstagramPhoto,
	handleInstagramQuickReply,
	handleInstagramText
} from '../instagram/flow'
import { verifyInstagramSignature } from '../instagram/service'

// формат апдейта — тот же, что у Meta Messenger Platform (Instagram DM через
// Graph API использует ту же структуру entry[].messaging[])
type InstagramUpdate = {
	entry?: {
		messaging?: {
			sender?: { id?: string }
			// эхо собственного сообщения, отправленного через Send API — приходит,
			// только если на странице отдельно включена подписка message_echoes
			// (мы её не включаем); проверка здесь — просто дополнительная страховка
			message?: {
				is_echo?: boolean
				text?: string
				quick_reply?: { payload?: string }
				attachments?: { type?: string; payload?: { url?: string } }[]
			}
		}[]
	}[]
}

export const instagramRoutes = new Elysia()
	// верификация вебхука при подключении в Meta-кабинете (разовая) —
	// GET с hub.mode/hub.verify_token/hub.challenge, в ответ нужно вернуть
	// challenge как есть, если verify_token совпадает с нашим
	.get('/instagram/webhook', ({ query, set }) => {
		const q = query as Record<string, string | undefined>
		const mode = q['hub.mode']
		const token = q['hub.verify_token']
		const challenge = q['hub.challenge']
		if (
			mode === 'subscribe' &&
			!!INSTAGRAM_VERIFY_TOKEN &&
			token === INSTAGRAM_VERIFY_TOKEN
		) {
			set.headers['content-type'] = 'text/plain'
			return challenge ?? ''
		}
		set.status = 403
		return 'Forbidden'
	})
	.post('/instagram/webhook', async ({ request, headers, set }) => {
		// подпись считается по сырому телу запроса — поэтому не даём Elysia
		// распарсить body заранее (схема body не задана) и читаем request.text() сами
		const rawBody = await request.text()
		if (!verifyInstagramSignature(rawBody, headers['x-hub-signature-256'])) {
			set.status = 401
			return { error: 'Unauthorized' }
		}

		let update: InstagramUpdate
		try {
			update = JSON.parse(rawBody)
		} catch {
			return { ok: true }
		}

		for (const entry of update.entry ?? []) {
			for (const event of entry.messaging ?? []) {
				const psid = event.sender?.id
				const message = event.message
				if (!psid || !message || message.is_echo) continue

				const quickReplyPayload = message.quick_reply?.payload
				if (quickReplyPayload) {
					await handleInstagramQuickReply(psid, quickReplyPayload)
					continue
				}

				const imageAttachment = message.attachments?.find(a => a.type === 'image')
				if (imageAttachment?.payload?.url) {
					await handleInstagramPhoto(psid, imageAttachment.payload.url, message.text)
					continue
				}

				// Meta ждёт 200 даже если апдейт нам неинтересен (стикер, видео и т.п.) —
				// иначе будет слать повторно
				const text = message.text?.trim()
				if (text) await handleInstagramText(psid, text)
			}
		}

		return { ok: true }
	})
