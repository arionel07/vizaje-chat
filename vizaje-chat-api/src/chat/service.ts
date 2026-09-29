import { desc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { conversations, messages } from '../db/schema'

export async function addMessage(
	conversationId: number,
	sender: 'visitor' | 'admin' | 'bot',
	text: string
) {
	// посетитель пишет в закрытую беседу — открываем её заново
	if (sender === 'visitor') {
		const [conversation] = await db
			.select({ status: conversations.status })
			.from(conversations)
			.where(eq(conversations.id, conversationId))
		if (conversation?.status === 'closed') {
			await updateConversationStatus(conversationId, 'open')
		}
	}

	const [message] = await db
		.insert(messages)
		.values({ conversationId, sender, text })
		.returning()
	return message
}

export async function conversationExists(conversationId: number) {
	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return !!row
}

export async function getMessages(conversationId: number) {
	return db
		.select()
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
}

export async function getConversations() {
	return db.select().from(conversations).orderBy(desc(conversations.createdAt))
}

export async function updateConversationStatus(
	conversationId: number,
	status: 'open' | 'closed'
) {
	const [updated] = await db
		.update(conversations)
		.set({ status })
		.where(eq(conversations.id, conversationId))
		.returning()
	await addMessage(
		conversationId,
		'system',
		status === 'closed' ? 'Беседа закрыта' : 'Беседа открыта заново'
	)
	return updated
}
