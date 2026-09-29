import { Elysia } from 'elysia'
import jwt from 'jsonwebtoken'
import { verifyToken } from '../auth/guard'
import { addMessage } from '../chat/service'
import { verifySessionToken } from '../widget/service'

type ConnStore =
	| { type: 'visitor'; conversationId: number }
	| { type: 'admin'; email: string }

const connections = new Map<string, ConnStore>()

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

		console.log('WS connected:', store)
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

		if (store.type === 'visitor') {
			const text = (body as { text: string }).text
			const msg = await addMessage(store.conversationId, 'visitor', text)
			const payload = JSON.stringify(msg)
			ws.publish(`conversation:${store.conversationId}`, payload)
			ws.publish('admin:global', payload)
		}

		if (store.type === 'admin') {
			const { conversationId, text } = body as {
				conversationId: number
				text: string
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
