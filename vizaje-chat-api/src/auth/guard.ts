import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET!

export function verifyToken(authHeader?: string) {
	if (!authHeader?.startsWith('Bearer ')) return null

	const token = authHeader.slice(7)
	try {
		return jwt.verify(token, JWT_SECRET) as { sub: number; email: string }
	} catch {
		return null
	}
}
