import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { db } from '../db/client'
import { conversations } from '../db/schema'
import { JWT_SECRET } from '../config'

export async function createSession() {
	const sessionId = randomUUID()

	const [conversation] = await db
		.insert(conversations)
		.values({ sessionId })
		.returning()
	if (!conversation) throw new Error('Failed to create conversation')

	const token = jwt.sign(
		{ type: 'visitor', sessionId, conversationId: conversation.id },
		JWT_SECRET,
		{
			expiresIn: '30d'
		}
	)

	return { token, conversationId: conversation.id }
}

export function verifySessionToken(authHeader?: string) {
	if (!authHeader?.startsWith('Bearer ')) return null
	const token = authHeader.slice(7)
	try {
		const payload = jwt.verify(token, JWT_SECRET) as {
			type?: string
			sessionId: string
			conversationId: number
		}
		if (payload.type !== 'visitor') return null
		return payload
	} catch {
		return null
	}
}
