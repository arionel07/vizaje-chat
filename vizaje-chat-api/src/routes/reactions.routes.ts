import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { publishToAdmins } from '../chat/events'
import { getMessageConversationId } from '../chat/service'
import {
	getReactionsForMessage,
	isReactionEmoji,
	removeReaction,
	setReaction
} from '../chat/reactions'

// реакции — чисто для операторов (видно и ставится только в админке, посетитель
// их не видит), поэтому событие шлём только в admin:global, а не в
// conversation:{id} — ту комнату слушает ещё и WS-подключение посетителя
async function broadcastReaction(conversationId: number, messageId: number) {
	const reactions = await getReactionsForMessage(messageId)
	publishToAdmins({ type: 'reaction', conversationId, messageId, reactions })
}

export const reactionsRoutes = new Elysia()
	.put(
		'/admin/messages/:id/reaction',
		async ({ headers, params, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			if (!isReactionEmoji(body.emoji)) {
				set.status = 422
				return { error: 'Unsupported emoji' }
			}
			const messageId = Number(params.id)
			const conversationId = await getMessageConversationId(messageId)
			if (conversationId === null) {
				set.status = 404
				return { error: 'Message not found' }
			}
			await setReaction(messageId, admin.sub, body.emoji)
			await broadcastReaction(conversationId, messageId)
			return { ok: true }
		},
		{ body: t.Object({ emoji: t.String() }) }
	)
	.delete('/admin/messages/:id/reaction', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const messageId = Number(params.id)
		const conversationId = await getMessageConversationId(messageId)
		if (conversationId === null) {
			set.status = 404
			return { error: 'Message not found' }
		}
		await removeReaction(messageId, admin.sub)
		await broadcastReaction(conversationId, messageId)
		return { ok: true }
	})
