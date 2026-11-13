import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { adminUsers, messageReactions } from '../db/schema'

// 4 популярных реакции, фиксированный набор — не настраивается через API
export const REACTION_EMOJIS = ['❤️', '👍', '🔥', '🙏'] as const
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number]

export function isReactionEmoji(value: unknown): value is ReactionEmoji {
	return (
		typeof value === 'string' &&
		(REACTION_EMOJIS as readonly string[]).includes(value)
	)
}

export type MessageReaction = { emoji: string; adminId: number; adminEmail: string }

// один оператор — одна реакция на сообщение (unique messageId+adminId в схеме);
// повторная простановка другого эмодзи заменяет прежний, не добавляет вторую
export async function setReaction(
	messageId: number,
	adminId: number,
	emoji: ReactionEmoji
) {
	await db
		.insert(messageReactions)
		.values({ messageId, adminId, emoji })
		.onConflictDoUpdate({
			target: [messageReactions.messageId, messageReactions.adminId],
			set: { emoji, createdAt: new Date() }
		})
}

export async function removeReaction(messageId: number, adminId: number) {
	await db
		.delete(messageReactions)
		.where(
			and(
				eq(messageReactions.messageId, messageId),
				eq(messageReactions.adminId, adminId)
			)
		)
}

// реакции сразу для пачки сообщений (используется при загрузке истории) —
// один запрос вместо N, сгруппировано по messageId
export async function getReactionsForMessages(
	messageIds: number[]
): Promise<Map<number, MessageReaction[]>> {
	const map = new Map<number, MessageReaction[]>()
	if (messageIds.length === 0) return map

	const rows = await db
		.select({
			messageId: messageReactions.messageId,
			emoji: messageReactions.emoji,
			adminId: messageReactions.adminId,
			adminEmail: adminUsers.email
		})
		.from(messageReactions)
		.innerJoin(adminUsers, eq(messageReactions.adminId, adminUsers.id))
		.where(inArray(messageReactions.messageId, messageIds))

	for (const r of rows) {
		const list = map.get(r.messageId) ?? []
		list.push({ emoji: r.emoji, adminId: r.adminId, adminEmail: r.adminEmail })
		map.set(r.messageId, list)
	}
	return map
}

export async function getReactionsForMessage(messageId: number) {
	const map = await getReactionsForMessages([messageId])
	return map.get(messageId) ?? []
}
