import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	uniqueIndex
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

// канал, которым посетитель пишет — влияет только на то, откуда взялось
// sessionId и куда дублировать ответ оператора (см. telegram/service.ts)
export const conversationChannel = pgEnum('conversation_channel', [
	'widget',
	'telegram',
	'instagram'
])

export const conversations = pgTable('conversations', {
	id: serial('id').primaryKey(),
	// анонимный ID посетителя: для widget — UUID сессии, для telegram —
	// `telegram:<chatId>`, для instagram — `instagram:<IGSID>`
	sessionId: text('session_id').notNull().unique(),
	channel: conversationChannel('channel').default('widget').notNull(),
	// только для channel='telegram' — куда слать ответ оператора через Bot API
	telegramChatId: text('telegram_chat_id'),
	// только для channel='instagram' — Instagram-scoped ID отправителя (IGSID),
	// куда слать ответ оператора через Send API
	instagramUserId: text('instagram_user_id'),
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
		// вложение (картинка) — не отдельная таблица: одно сообщение = максимум
		// один файл, этого достаточно по задаче. Удаляются вместе по cron-очистке
		// (uploads/cleanup.ts) — файл с диска + эти поля, текст сообщения остаётся
		attachmentUrl: text('attachment_url'),
		attachmentType: text('attachment_type'),
		attachmentName: text('attachment_name'),
		attachmentSize: integer('attachment_size'),
		// системные сообщения о смене статуса беседы («Беседа закрыта»/«открыта
		// заново») — только для оператора: посетителю статус «закрыто» на фоне
		// его же вопроса читается резковато, он и так понимает по ответу
		// оператора, что вопрос решён. Не публикуется и не отдаётся по
		// /widget/messages (см. getMessages/updateConversationStatus)
		adminOnly: boolean('admin_only').default(false).notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	t => [index('messages_conversation_id_idx').on(t.conversationId, t.id)]
)

// реакции оператора на сообщение (❤️ 👍 🔥 🙏, см. chat/reactions.ts) — только
// для админки, посетитель их не видит и не ставит сам. Один оператор — одна
// реакция на сообщение (unique ниже): повторная простановка другого эмодзи
// просто заменяет прежний, не добавляет вторую
export const messageReactions = pgTable(
	'message_reactions',
	{
		id: serial('id').primaryKey(),
		messageId: integer('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		adminId: integer('admin_id')
			.notNull()
			.references(() => adminUsers.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	t => [
		index('message_reactions_message_id_idx').on(t.messageId),
		uniqueIndex('message_reactions_message_admin_unique').on(t.messageId, t.adminId)
	]
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

// автоответы бота: triggerText — точный текст сообщения/quick-reply кнопки,
// по которому бот отвечает сам, без участия оператора
export const botResponses = pgTable('bot_responses', {
	id: serial('id').primaryKey(),
	triggerText: text('trigger_text').notNull(),
	answerRu: text('answer_ru').notNull(),
	answerRo: text('answer_ro').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
})

export const pushPlatform = pgEnum('push_platform', ['ios', 'android'])

// Expo push-токены мобильных устройств операторов; token — глобально уникален:
// один и тот же токен переезжает на нового админа, если устройство сменило владельца
export const pushTokens = pgTable(
	'push_tokens',
	{
		id: serial('id').primaryKey(),
		adminId: integer('admin_id')
			.notNull()
			.references(() => adminUsers.id, { onDelete: 'cascade' }),
		token: text('token').notNull().unique(),
		platform: pushPlatform('platform').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	t => [index('push_tokens_admin_id_idx').on(t.adminId)]
)

// Web Push-подписки браузера (админка на телефоне/десктопе, не мобильное
// приложение — для него см. pushTokens выше). endpoint — глобально уникален,
// выдаётся самим браузером конкретной связке "устройство + браузер + сайт";
// p256dh/auth — ключи шифрования пуша, тоже из подписки браузера
export const webPushSubscriptions = pgTable(
	'web_push_subscriptions',
	{
		id: serial('id').primaryKey(),
		adminId: integer('admin_id')
			.notNull()
			.references(() => adminUsers.id, { onDelete: 'cascade' }),
		endpoint: text('endpoint').notNull().unique(),
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	t => [index('web_push_subscriptions_admin_id_idx').on(t.adminId)]
)
