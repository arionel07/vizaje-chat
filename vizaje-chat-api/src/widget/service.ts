import { randomUUID } from 'crypto'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { db } from '../db/client'
import { conversations } from '../db/schema'
import { JWT_SECRET } from '../config'

// Сессия выдаётся сразу (без обращения к БД) — беседа создаётся только когда
// посетитель реально отправляет первое сообщение (см. getOrCreateConversationId).
// Иначе открытие чата (или сбой до первого сообщения, из-за которого клиент
// начинает сессию заново) плодило бы в админке пустые беседы без сообщений.
export function createSession() {
	const sessionId = randomUUID()
	const token = jwt.sign({ type: 'visitor', sessionId }, JWT_SECRET, {
		expiresIn: '30d'
	})
	return { token }
}

export function verifySessionToken(authHeader?: string) {
	if (!authHeader?.startsWith('Bearer ')) return null
	const token = authHeader.slice(7)
	try {
		const payload = jwt.verify(token, JWT_SECRET) as {
			type?: string
			sessionId: string
		}
		if (payload.type !== 'visitor' || !payload.sessionId) return null
		return { sessionId: payload.sessionId }
	} catch {
		return null
	}
}

// Только чтение — ничего не создаёт. Для истории/статуса/экспорта: пока
// посетитель не написал, у него просто нет беседы, и это нормальное состояние
export async function findConversationIdBySessionId(sessionId: string) {
	const [row] = await db
		.select({ id: conversations.id })
		.from(conversations)
		.where(eq(conversations.sessionId, sessionId))
	return row?.id ?? null
}

// Вызывается только в момент отправки сообщения. sessionId уникален на уровне
// БД — при гонке (например, два вкладки с одним токеном отправляют одновременно)
// insert у одной из них молча не пройдёт, и мы просто дочитаем уже вставленную строку
export async function getOrCreateConversationId(sessionId: string) {
	const existingId = await findConversationIdBySessionId(sessionId)
	if (existingId !== null) return existingId

	const [inserted] = await db
		.insert(conversations)
		.values({ sessionId })
		.onConflictDoNothing({ target: conversations.sessionId })
		.returning({ id: conversations.id })
	if (inserted) return inserted.id

	const id = await findConversationIdBySessionId(sessionId)
	if (id === null) throw new Error('Failed to get or create conversation')
	return id
}
