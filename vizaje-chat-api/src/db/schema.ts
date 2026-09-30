import {
	type AnyPgColumn,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp
} from 'drizzle-orm/pg-core'

export const adminUsers = pgTable('admin_users', {
	id: serial('id').primaryKey(),
	email: text('email').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
})

export const conversationStatus = pgEnum('conversation_status', [
	'open',
	'closed'
])

export const conversations = pgTable('conversations', {
	id: serial('id').primaryKey(),
	sessionId: text('session_id').notNull().unique(), // анонимный ID посетителя с сайта
	status: conversationStatus('status').default('open').notNull(),
	// когда оператор в последний раз открывал беседу; от него считаются непрочитанные
	adminLastReadAt: timestamp('admin_last_read_at'),
	// когда посетитель в последний раз видел сообщения (виджет открыт); для «Прочитано»
	visitorLastReadAt: timestamp('visitor_last_read_at'),
	// оператор, за которым закреплена беседа; при удалении оператора — снимается
	assigneeId: integer('assignee_id').references(() => adminUsers.id, {
		onDelete: 'set null'
	}),
	createdAt: timestamp('created_at').defaultNow().notNull()
})

export const senderType = pgEnum('sender_type', [
	'visitor',
	'admin',
	'bot',
	'system'
])

export const messages = pgTable(
	'messages',
	{
		id: serial('id').primaryKey(),
		conversationId: integer('conversation_id')
			.notNull()
			.references(() => conversations.id),
		sender: senderType('sender').notNull(),
		text: text('text').notNull(),
		// ответ на сообщение (цитата); при удалении исходного остаётся без цитаты
		replyToId: integer('reply_to_id').references((): AnyPgColumn => messages.id, {
			onDelete: 'set null'
		}),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	t => [index('messages_conversation_id_idx').on(t.conversationId, t.id)]
)

// key-value для простых глобальных настроек (пока только рабочий график)
export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// заготовки ответов оператора: title — язык-нейтральный заголовок для списка/поиска
export const cannedResponses = pgTable('canned_responses', {
	id: serial('id').primaryKey(),
	title: text('title').notNull(),
	textRu: text('text_ru').notNull(),
	textRo: text('text_ro').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
})
