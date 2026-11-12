import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/client'
import { adminUsers, conversations, messages } from '../db/schema'
import { notifyAdminsOfAiHandoff } from '../push-tokens/notify'
import { getAiBotEnabled } from '../settings/service'
import { publishMessage, publishToAdmins } from './events'

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

export type Attachment = {
	url: string
	type: string
	name: string
	size: number
}

// кнопки под сообщением ИИ-бота (см. ai-bot/service.ts) — 'send_text' шлёт
// value как обычное сообщение посетителя (как quick-reply), 'open_url'
// просто открывает ссылку в новой вкладке
export type MessageAction = { label: string; type: 'send_text' | 'open_url'; value: string }

// replyToId должен быть заранее проверен через replyTargetExists.
// adminOnly — только для системных сообщений о статусе беседы (см. ниже):
// не должно отдаваться и публиковаться посетителю
export async function addMessage(
	conversationId: number,
	sender: 'visitor' | 'admin' | 'bot' | 'system',
	text: string,
	replyToId?: number | null,
	attachment?: Attachment | null,
	adminOnly?: boolean,
	actions?: MessageAction[] | null
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
		.values({
			conversationId,
			sender,
			text,
			replyToId: replyToId ?? null,
			attachmentUrl: attachment?.url ?? null,
			attachmentType: attachment?.type ?? null,
			attachmentName: attachment?.name ?? null,
			attachmentSize: attachment?.size ?? null,
			adminOnly: adminOnly ?? false,
			actions: actions ?? null
		})
		.returning()
	if (!message) throw new Error('Failed to insert message')
	return {
		...message,
		replyTo: replyToId ? await getReplyTo(replyToId) : null
	}
}

// беседа, которой принадлежит сообщение — нужно знать, в какую WS-комнату
// слать событие о реакции (см. routes/reactions.routes.ts)
export async function getMessageConversationId(messageId: number) {
	const [row] = await db
		.select({ conversationId: messages.conversationId })
		.from(messages)
		.where(eq(messages.id, messageId))
	return row?.conversationId ?? null
}

export async function conversationExists(conversationId: number) {
	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return !!row
}

// канал беседы + внешний ID получателя для этого канала — чтобы при ответе
// оператора понять, куда (и нужно ли) дублировать сообщение (см. ws.routes.ts)
export async function getConversationChannel(conversationId: number) {
	const [row] = await db
		.select({
			channel: conversations.channel,
			telegramChatId: conversations.telegramChatId,
			instagramUserId: conversations.instagramUserId
		})
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	return row ?? null
}

export const DEFAULT_MESSAGES_LIMIT = 50
export const MAX_MESSAGES_LIMIT = 200

// Последние `limit` сообщений в хронологическом порядке.
// `before` — id сообщения: вернуть только более старые (для подгрузки истории)
export async function getMessages(
	conversationId: number,
	{
		limit,
		before,
		excludeAdminOnly
	}: { limit?: number; before?: number; excludeAdminOnly?: boolean } = {}
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
			attachmentUrl: messages.attachmentUrl,
			attachmentType: messages.attachmentType,
			attachmentName: messages.attachmentName,
			attachmentSize: messages.attachmentSize,
			actions: messages.actions,
			parentSender: parent.sender,
			parentText: sql<string | null>`left(${parent.text}, ${REPLY_SNIPPET_LENGTH})`
		})
		.from(messages)
		.leftJoin(parent, eq(messages.replyToId, parent.id))
		.where(
			and(
				eq(messages.conversationId, conversationId),
				before ? lt(messages.id, before) : undefined,
				excludeAdminOnly ? eq(messages.adminOnly, false) : undefined
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

// беседа «ждёт ответа» — последнее сообщение от посетителя (независимо от
// того, прочитал ли его оператор: «непрочитано» и «ждёт ответа» — разные
// вещи, оператор мог открыть беседу и пока не ответить). coalesce(..., false) —
// в пустой беседе (нет сообщений вообще) подзапрос даёт null, считаем «не ждёт»
const awaitingReplyExpr = () => sql`coalesce((
	select m.sender = 'visitor' from messages m
	where m.conversation_id = ${convId}
	order by m.id desc limit 1
), false)`

// Беседы, отсортированные по последней активности, с последним сообщением
// и числом непрочитанных сообщений посетителя.
// status — только открытые/закрытые; unread — только с непрочитанными;
// unanswered — только те, где последнее сообщение от посетителя (ждут ответа);
// assignee: 'me' — назначенные на meId, 'unassigned' — без назначения;
// assigneeId — на конкретного оператора (быстрый переход «беседы коллеги»,
// независимо от того, кто сейчас залогинен) — приоритетнее assignee, если оба заданы;
// q — по тексту сообщений (вся история беседы) и sessionId, регистронезависимо
export async function getConversations({
	limit,
	offset,
	status,
	unread,
	unanswered,
	assignee,
	assigneeId,
	meId,
	q
}: {
	limit?: number
	offset?: number
	status?: 'open' | 'closed'
	unread?: boolean
	unanswered?: boolean
	assignee?: 'me' | 'unassigned'
	assigneeId?: number
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
			channel: conversations.channel,
			status: conversations.status,
			createdAt: conversations.createdAt,
			visitorLastReadAt: conversations.visitorLastReadAt,
			assigneeId: conversations.assigneeId,
			assigneeEmail: adminUsers.email,
			aiHandedOff: conversations.aiHandedOff,
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
			lastMessageHasAttachment: sql<boolean>`(
				select m.attachment_url is not null from messages m
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
				unanswered ? sql`${awaitingReplyExpr()}` : undefined,
				assigneeId != null
					? eq(conversations.assigneeId, assigneeId)
					: assignee === 'unassigned'
						? isNull(conversations.assigneeId)
						: assignee === 'me' && meId != null
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

// счётчики для фильтров: открытые, закрытые, с непрочитанными, ждут ответа, мои
export async function getConversationCounts(meId?: number) {
	const [row] = await db
		.select({
			open: sql<number>`(count(*) filter (where "conversations"."status" = 'open'))::int`,
			closed: sql<number>`(count(*) filter (where "conversations"."status" = 'closed'))::int`,
			unread: sql<number>`(count(*) filter (where ${unreadCountExpr()} > 0))::int`,
			unanswered: sql<number>`(count(*) filter (where ${awaitingReplyExpr()}))::int`,
			mine: sql<number>`(count(*) filter (where "conversations"."assignee_id" = ${meId ?? null}))::int`
		})
		.from(conversations)
	return row ?? { open: 0, closed: 0, unread: 0, unanswered: 0, mine: 0 }
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
	// adminOnly — посетителю не показываем и не публикуем: статус беседы
	// касается только оператора, посетитель и так видит, что ему ответили
	const systemMessage = await addMessage(
		conversationId,
		'system',
		status === 'closed' ? 'Беседа закрыта' : 'Беседа открыта заново',
		undefined,
		undefined,
		true
	)
	publishToAdmins(systemMessage)
	return updated
}

// ИИ-бот передаёт беседу оператору (ai-bot/service.ts) — дальше бот в этой
// беседе больше не отвечает, только оператор. summary — adminOnly системное
// сообщение для оператора (не видно посетителю), коротко о чём шла речь, раз
// оператор не читал переписку с начала
// общий префикс системного сообщения о передаче — по нему же ai-bot/service.ts
// находит такие сообщения для журнала «Передачи ИИ» в настройках, не заводя
// отдельную таблицу под то, что и так уже лежит в messages
export const AI_HANDOFF_PREFIX = 'ИИ передал беседу оператору: '

export async function handoffConversationToOperator(conversationId: number, summary: string) {
	await db
		.update(conversations)
		.set({ aiHandedOff: true })
		.where(eq(conversations.id, conversationId))
	const systemMessage = await addMessage(
		conversationId,
		'system',
		`${AI_HANDOFF_PREFIX}${summary}`,
		undefined,
		undefined,
		true
	)
	publishToAdmins(systemMessage)
	// best-effort, не блокирует и не роняет хэндофф при сбое пуша
	notifyAdminsOfAiHandoff(conversationId, summary).catch(error =>
		console.error('Failed to notify admins of AI handoff:', error)
	)
}

// ИИ-бот молчит, если: общий выключатель в настройках выключен (предохранитель
// оператора, см. settings/service.ts), уже передавал эту беседу раньше, или
// за ней уже закреплён оператор (назначение — явный сигнал, что человек уже
// в теме; не хотим, чтобы бот влезал поверх живого разговора)
export async function shouldAiRespond(conversationId: number) {
	if (!(await getAiBotEnabled())) return false
	const [row] = await db
		.select({ aiHandedOff: conversations.aiHandedOff, assigneeId: conversations.assigneeId })
		.from(conversations)
		.where(eq(conversations.id, conversationId))
	if (!row) return false
	return !row.aiHandedOff && row.assigneeId === null
}

// безвозвратно: сообщения удаляются вместе с беседой (reply_to_id у них —
// onDelete: 'set null', порядок удаления не важен). Доступ гейтится настройкой
// conversationDeleteEnabled — см. settings/service.ts и роут
export async function deleteConversation(conversationId: number) {
	await db.delete(messages).where(eq(messages.conversationId, conversationId))
	const [deleted] = await db
		.delete(conversations)
		.where(eq(conversations.id, conversationId))
		.returning({ id: conversations.id })
	return !!deleted
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
// excludeAdminOnly — для экспорта из виджета (GET /widget/export): статус
// беседы посетителю не показываем нигде, в т.ч. в его же скачанной истории
export async function exportConversationText(
	conversationId: number,
	excludeAdminOnly?: boolean
) {
	const exists = await conversationExists(conversationId)
	if (!exists) return null

	const rows = await db
		.select({
			sender: messages.sender,
			text: messages.text,
			createdAt: messages.createdAt,
			attachmentUrl: messages.attachmentUrl,
			attachmentName: messages.attachmentName
		})
		.from(messages)
		.where(
			and(
				eq(messages.conversationId, conversationId),
				excludeAdminOnly ? eq(messages.adminOnly, false) : undefined
			)
		)
		.orderBy(messages.id)

	const lines = rows.map(m => {
		if (m.sender === 'system') return `--- ${m.text} ---`
		const attachmentNote = m.attachmentUrl
			? `[изображение: ${m.attachmentName ?? m.attachmentUrl}]`
			: null
		const text = [m.text || null, attachmentNote].filter(Boolean).join(' ')
		return `[${formatExportDate(m.createdAt)}] ${EXPORT_SENDER_LABELS[m.sender] ?? m.sender}: ${text}`
	})

	const header = `Беседа #${conversationId} — экспортировано ${formatExportDate(new Date())}`
	return [header, '', ...lines].join('\n')
}
