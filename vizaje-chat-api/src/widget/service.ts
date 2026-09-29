import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { db } from '../db/client'
import { conversations } from '../db/schema'

const JWT_SECRET = process.env.JWT_SECRET!

export async function createSession() {
	const sessionId = randomUUID()

	const [conversation] = await db
		.insert(conversations)
		.values({ sessionId })
		.returning()

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
		return jwt.verify(token, JWT_SECRET) as {
			sessionId: string
			conversationId: number
		}
	} catch {
		return null
	}
}
