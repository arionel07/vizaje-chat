import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET!

export function verifyToken(authHeader?: string) {
	if (!authHeader?.startsWith('Bearer ')) return null

	const token = authHeader.slice(7)
	try {
		const payload = jwt.verify(token, JWT_SECRET) as {
			type?: string
			sub: number
			email: string
		}
		if (payload.type !== 'admin') return null
		return payload
	} catch {
		return null
	}
}
