import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/client'
import { adminUsers, conversations, messages } from '../db/schema'
import { publishMessage } from './events'

// список операторов для назначения бесед
export async function getOperators() {
	return db
		.select({ id: adminUsers.id, email: adminUsers.email })
		.from(adminUsers)
		.orderBy(adminUsers.email)
}

export async function operatorExists(id: number) {
	const [row] = await db
		.select({ id: adminUsers.id })
		.from(adminUsers)
		.where(eq(adminUsers.id, id))
	return !!row
}

// Цитата в ответе: краткая выдержка из исходного сообщения
export const REPLY_SNIPPET_LENGTH = 200
export type ReplyTo = { id: number; sender: string; text: string }

// Ответить можно только на сообщение из той же беседы (иначе чужой текст утёк бы в цитату)
export async function replyTargetExists(
	conversationId: number,
	messageId: number
) {
	const [row] = await db
		.select({ id: messages.id })
		.from(messages)
		.where(
			and(
				eq(messages.id, messageId),
				eq(messages.conversationId, conversationId)
			)
		)
	return !!row
}

async function getReplyTo(messageId: number): Promise<ReplyTo | null> {
	const [row] = await db
		.select({
			id: messages.id,
			sender: messages.sender,
			text: sql<string>`left(${messages.text}, ${REPLY_SNIPPET_LENGTH})`
		})
		.from(messages)
		.where(eq(messages.id, messageId))
	return row ?? null
}

// replyToId должен быть заранее проверен через replyTargetExists
export async function addMessage(
	conversationId: number,
	sender: 'visitor' | 'admin' | 'bot' | 'system',
	text: string,
	replyToId?: number | null
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
		.values({ conversationId, sender, text, replyToId: replyToId ?? null })
		.returning()
	if (!message) throw new Error('Failed to insert message')
	return {
		...message,
		replyTo: replyToId ? await getReplyTo(replyToId) : null
	}
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
	const parent = alias(messages, 'parent')
	const rows = await db
		.select({
			id: messages.id,
			conversationId: messages.conversationId,
			sender: messages.sender,
			text: messages.text,
			createdAt: messages.createdAt,
			replyToId: messages.replyToId,
			parentSender: parent.sender,
			parentText: sql<string | null>`left(${parent.text}, ${REPLY_SNIPPET_LENGTH})`
		})
		.from(messages)
		.leftJoin(parent, eq(messages.replyToId, parent.id))
		.where(
			and(
				eq(messages.conversationId, conversationId),
				before ? lt(messages.id, before) : undefined
			)
		)
		.orderBy(desc(messages.id))
		.limit(size)
	return rows.reverse().map(({ parentSender, parentText, ...m }) => ({
		...m,
		replyTo:
			m.replyToId && parentSender && parentText !== null
				? { id: m.replyToId, sender: parentSender, text: parentText }
				: null
	}))
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
// status — только открытые/закрытые; unread — только с непрочитанными;
// assignee: 'me' — назначенные на meId, 'unassigned' — без назначения;
// q — по тексту сообщений (вся история беседы) и sessionId, регистронезависимо
export async function getConversations({
	limit,
	offset,
	status,
	unread,
	assignee,
	meId,
	q
}: {
	limit?: number
	offset?: number
	status?: 'open' | 'closed'
	unread?: boolean
	assignee?: 'me' | 'unassigned'
	meId?: number
	q?: string
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

	// экранируем спецсимволы ILIKE, чтобы "%" или "_" в запросе не вели себя как маска
	const term = q?.trim()
	const likePattern = term && `%${term.replace(/[\\%_]/g, '\\$&')}%`
	const searchCondition = likePattern
		? sql`(
			${conversations.sessionId} ilike ${likePattern} escape '\\'
			or exists (
				select 1 from messages m
				where m.conversation_id = ${convId} and m.text ilike ${likePattern} escape '\\'
			)
		)`
		: undefined

	return db
		.select({
			id: conversations.id,
			sessionId: conversations.sessionId,
			status: conversations.status,
			createdAt: conversations.createdAt,
			visitorLastReadAt: conversations.visitorLastReadAt,
			assigneeId: conversations.assigneeId,
			assigneeEmail: adminUsers.email,
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
		.leftJoin(adminUsers, eq(conversations.assigneeId, adminUsers.id))
		.where(
			and(
				status ? eq(conversations.status, status) : undefined,
				unread ? sql`${unreadCountExpr()} > 0` : undefined,
				assignee === 'unassigned' ? isNull(conversations.assigneeId) : undefined,
				assignee === 'me' && meId != null
					? eq(conversations.assigneeId, meId)
					: undefined,
				searchCondition
			)
		)
		.orderBy(
			desc(sql`coalesce(${lastAt()}, ${convCreatedAt})`),
			desc(conversations.id)
		)
		.limit(size)
		.offset(skip)
}

// счётчики для фильтров: открытые, закрытые, с непрочитанными, мои
export async function getConversationCounts(meId?: number) {
	const [row] = await db
		.select({
			open: sql<number>`(count(*) filter (where "conversations"."status" = 'open'))::int`,
			closed: sql<number>`(count(*) filter (where "conversations"."status" = 'closed'))::int`,
			unread: sql<number>`(count(*) filter (where ${unreadCountExpr()} > 0))::int`,
			mine: sql<number>`(count(*) filter (where "conversations"."assignee_id" = ${meId ?? null}))::int`
		})
		.from(conversations)
	return row ?? { open: 0, closed: 0, unread: 0, mine: 0 }
}

// назначить беседу оператору или снять назначение (assigneeId: null).
// пишет системное сообщение и публикует его по WS, как при смене статуса
export async function updateConversationAssignee(
	conversationId: number,
	assigneeId: number | null
) {
	const [updated] = await db
		.update(conversations)
		.set({ assigneeId })
		.where(eq(conversations.id, conversationId))
		.returning()
	if (!updated) return null

	let assigneeEmail: string | null = null
	if (assigneeId != null) {
		const [operator] = await db
			.select({ email: adminUsers.email })
			.from(adminUsers)
			.where(eq(adminUsers.id, assigneeId))
		assigneeEmail = operator?.email ?? null
	}

	const systemMessage = await addMessage(
		conversationId,
		'system',
		assigneeEmail
			? `Беседа назначена на ${assigneeEmail}`
			: 'Назначение беседы снято'
	)
	publishMessage(conversationId, systemMessage)

	return { ...updated, assigneeEmail }
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

// таймзона фиксированная, как в рабочем графике — экспорт не зависит от TZ сервера
const EXPORT_TIMEZONE = 'Europe/Chisinau'
const exportDateParts = new Intl.DateTimeFormat('ru-RU', {
	timeZone: EXPORT_TIMEZONE,
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
})

// "29.09.2026 09:47" — без запятой, которую ru-RU вставляет между датой и временем
function formatExportDate(date: Date) {
	const parts = exportDateParts.formatToParts(date)
	const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
	return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

const EXPORT_SENDER_LABELS: Record<string, string> = {
	visitor: 'Посетитель',
	admin: 'Оператор',
	bot: 'Бот'
}

// Вся история беседы простым текстом для скачивания; null — беседы нет.
// Системные сообщения (смена статуса, назначение) — отдельной строкой без таймштампа,
// остальные — "[дата время] Отправитель: текст", в хронологическом порядке
export async function exportConversationText(conversationId: number) {
	const exists = await conversationExists(conversationId)
	if (!exists) return null

	const rows = await db
		.select({
			sender: messages.sender,
			text: messages.text,
			createdAt: messages.createdAt
		})
		.from(messages)
		.where(eq(messages.conversationId, conversationId))
		.orderBy(messages.id)

	const lines = rows.map(m =>
		m.sender === 'system'
			? `--- ${m.text} ---`
			: `[${formatExportDate(m.createdAt)}] ${EXPORT_SENDER_LABELS[m.sender] ?? m.sender}: ${m.text}`
	)

	const header = `Беседа #${conversationId} — экспортировано ${formatExportDate(new Date())}`
	return [header, '', ...lines].join('\n')
}
