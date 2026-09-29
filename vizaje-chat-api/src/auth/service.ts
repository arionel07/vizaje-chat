import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { db } from '../db/client'
import { adminUsers } from '../db/schema'

const JWT_SECRET = process.env.JWT_SECRET!

export async function createAdmin(email: string, password: string) {
	const passwordHash = await Bun.password.hash(password)
	return db.insert(adminUsers).values({ email, passwordHash }).returning()
}

export async function login(email: string, password: string) {
	const [user] = await db
		.select()
		.from(adminUsers)
		.where(eq(adminUsers.email, email))
	if (!user) return null

	const valid = await Bun.password.verify(password, user.passwordHash)
	if (!valid) return null

	const token = jwt.sign(
		{ type: 'admin', sub: user.id, email: user.email },
		JWT_SECRET,
		{
			expiresIn: '12h' // было '15m'
		}
	)
	return { token }
}
