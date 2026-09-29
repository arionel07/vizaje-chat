import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { conversations, messages } from '../db/schema'
import { publishMessage } from './events'

export async function addMessage(
	conversationId: number,
	sender: 'visitor' | 'admin' | 'bot' | 'system',
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
	if (!message) throw new Error('Failed to insert message')
	return message
}

export async function conversationExists(conversationId: number) {
	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return !!row
}

export const DEFAULT_MESSAGES_LIMIT = 50
export const MAX_MESSAGES_LIMIT = 200

// Последние `limit` сообщений в хронологическом порядке.
// `before` — id сообщения: вернуть только более старые (для подгрузки истории)
export async function getMessages(
	conversationId: number,
	{ limit, before }: { limit?: number; before?: number } = {}
) {
	const size = Math.min(
		Math.max(Math.trunc(limit ?? DEFAULT_MESSAGES_LIMIT), 1),
		MAX_MESSAGES_LIMIT
	)
	const rows = await db
		.select()
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				before ? lt(messages.id, before) : undefined
			)
		)
		.orderBy(desc(messages.id))
		.limit(size)
	return rows.reverse()
}

export const DEFAULT_CONVERSATIONS_LIMIT = 30
export const MAX_CONVERSATIONS_LIMIT = 100

// Drizzle в подзапросах выводит колонки без имени таблицы ("id"), и они
// склеиваются с messages.id — поэтому внешние колонки квалифицируем вручную
const convId = sql`"conversations"."id"`
const convCreatedAt = sql`"conversations"."created_at"`
const convReadAt = sql`"conversations"."admin_last_read_at"`

// число непрочитанных оператором сообщений посетителя в беседе
const unreadCountExpr = () => sql`(
	select count(*)::int from messages m
	where m.conversation_id = ${convId}
		and m.sender = 'visitor'
		and (
			${convReadAt} is null
			or m.created_at > ${convReadAt}
		)
)`

// Беседы, отсортированные по последней активности, с последним сообщением
// и числом непрочитанных сообщений посетителя.
// status — только открытые/закрытые; unread — только с непрочитанными
export async function getConversations({
	limit,
	offset,
	status,
	unread
}: {
	limit?: number
	offset?: number
	status?: 'open' | 'closed'
	unread?: boolean
} = {}) {
	const size = Math.min(
		Math.max(Math.trunc(limit ?? DEFAULT_CONVERSATIONS_LIMIT), 1),
		MAX_CONVERSATIONS_LIMIT
	)
	const skip = Math.max(Math.trunc(offset ?? 0), 0)

	const lastAt = () => sql`(
		select m.created_at from messages m
		where m.conversation_id = ${convId}
		order by m.id desc limit 1
	)`

	return db
		.select({
			id: conversations.id,
			sessionId: conversations.sessionId,
			status: conversations.status,
			createdAt: conversations.createdAt,
			visitorLastReadAt: conversations.visitorLastReadAt,
			lastMessageText: sql<string | null>`(
				select m.text from messages m
				where m.conversation_id = ${convId}
				order by m.id desc limit 1
			)`,
			lastMessageSender: sql<string | null>`(
				select m.sender::text from messages m
				where m.conversation_id = ${convId}
				order by m.id desc limit 1
			)`,
			lastMessageAt: sql<Date | null>`${lastAt()}`.mapWith(conversations.createdAt),
			unreadCount: sql<number>`${unreadCountExpr()}`
		})
		.from(conversations)
		.where(
			and(
				status ? eq(conversations.status, status) : undefined,
				unread ? sql`${unreadCountExpr()} > 0` : undefined
			)
		)
		.orderBy(
			desc(sql`coalesce(${lastAt()}, ${convCreatedAt})`),
			desc(conversations.id)
		)
		.limit(size)
		.offset(skip)
}

// счётчики для фильтров: открытые, закрытые, с непрочитанными
export async function getConversationCounts() {
	const [row] = await db
		.select({
			open: sql<number>`(count(*) filter (where "conversations"."status" = 'open'))::int`,
			closed: sql<number>`(count(*) filter (where "conversations"."status" = 'closed'))::int`,
			unread: sql<number>`(count(*) filter (where ${unreadCountExpr()} > 0))::int`
		})
		.from(conversations)
	return row ?? { open: 0, closed: 0, unread: 0 }
}

// Оператор прочитал беседу. Возвращает серверное время отметки, null — беседы нет
export async function markConversationRead(conversationId: number) {
	const [row] = await db
		.update(conversations)
		.set({ adminLastReadAt: sql`now()` })
		.where(eq(conversations.id, conversationId))
		.returning({ at: conversations.adminLastReadAt })
	return row?.at ?? null
}

// Посетитель увидел сообщения (виджет открыт). Возвращает время отметки
export async function markVisitorRead(conversationId: number) {
	const [row] = await db
		.update(conversations)
		.set({ visitorLastReadAt: sql`now()` })
		.where(eq(conversations.id, conversationId))
		.returning({ at: conversations.visitorLastReadAt })
	return row?.at ?? null
}

// когда оператор последний раз читал беседу — виджет показывает «Прочитано»
export async function getAdminReadAt(conversationId: number) {
	const [row] = await db
		.select({ at: conversations.adminLastReadAt })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return row?.at ?? null
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
	const systemMessage = await addMessage(
		conversationId,
		'system',
		status === 'closed' ? 'Беседа закрыта' : 'Беседа открыта заново'
	)
	publishMessage(conversationId, systemMessage)
	return updated
}
