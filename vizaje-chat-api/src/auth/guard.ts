import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config'

export function verifyToken(authHeader?: string) {
	if (!authHeader?.startsWith('Bearer ')) return null

	const token = authHeader.slice(7)
	try {
		const payload = jwt.verify(token, JWT_SECRET)
		if (typeof payload === 'string' || payload.type !== 'admin') return null
		return { sub: Number(payload.sub), email: String(payload.email) }
	} catch {
		return null
	}
}
