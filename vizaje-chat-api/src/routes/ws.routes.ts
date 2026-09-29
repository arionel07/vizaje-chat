import { Elysia } from 'elysia'
import jwt from 'jsonwebtoken'
import { verifyToken } from '../auth/guard'
import { allowVisitorMessage } from '../chat/rate-limit'
import { addMessage, conversationExists } from '../chat/service'
import { verifySessionToken } from '../widget/service'

type ConnStore =
	| { type: 'visitor'; conversationId: number }
	| { type: 'admin'; email: string }

const connections = new Map<string, ConnStore>()

const MAX_TEXT_LENGTH = 4000

// Elysia парсит JSON-строку в объект сам; невалидный JSON приходит строкой
function parseText(body: unknown): string | null {
	if (typeof body !== 'object' || body === null) return null
	const text = (body as { text?: unknown }).text
	if (typeof text !== 'string') return null
	const trimmed = text.trim()
	if (!trimmed || trimmed.length > MAX_TEXT_LENGTH) return null
	return trimmed
}

function sendError(ws: { send: (data: string) => unknown }, error: string) {
	ws.send(JSON.stringify({ type: 'error', error }))
}

export const wsRoutes = new Elysia().ws('/ws', {
	open(ws) {
		const token = ws.data.query.token as string | undefined
		const decoded = token ? (jwt.decode(token) as any) : null

		if (!decoded || (decoded.type !== 'visitor' && decoded.type !== 'admin')) {
			ws.close()
			return
		}

		let store: ConnStore
		if (decoded.type === 'visitor') {
			const session = verifySessionToken(`Bearer ${token}`)
			if (!session) {
				ws.close()
				return
			}
			store = { type: 'visitor', conversationId: session.conversationId }
		} else {
			const admin = verifyToken(`Bearer ${token}`)
			if (!admin) {
				ws.close()
				return
			}
			store = { type: 'admin', email: admin.email }
		}

		console.log(
			'WS connected:',
			store.type === 'visitor'
				? `visitor, conversation ${store.conversationId}`
				: 'admin'
		)
		connections.set(ws.id, store)
		ws.subscribe(
			store.type === 'visitor'
				? `conversation:${store.conversationId}`
				: 'admin:global'
		)
	},
	async message(ws, body) {
		const store = connections.get(ws.id)
		if (!store) return

		const text = parseText(body)
		if (!text) {
			sendError(ws, 'Invalid message')
			return
		}

		if (store.type === 'visitor') {
			if (!allowVisitorMessage(store.conversationId)) {
				sendError(ws, 'Too many messages')
				return
			}
			const msg = await addMessage(store.conversationId, 'visitor', text)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${store.conversationId}`, payload)
			ws.publish('admin:global', payload)
		}

		if (store.type === 'admin') {
			const conversationId = (body as { conversationId?: unknown })
				.conversationId
			if (
				typeof conversationId !== 'number' ||
				!Number.isInteger(conversationId) ||
				!(await conversationExists(conversationId))
			) {
				sendError(ws, 'Conversation not found')
				return
			}
			const msg = await addMessage(conversationId, 'admin', text)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${conversationId}`, payload)
			ws.publish('admin:global', payload)
		}
	},
	close(ws) {
		connections.delete(ws.id)
	}
})
