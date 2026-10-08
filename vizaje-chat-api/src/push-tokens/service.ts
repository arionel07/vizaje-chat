import { db } from '../db/client'
import { pushTokens } from '../db/schema'

// upsert по token: один и тот же Expo push-токен переезжает на нового
// админа/платформу, если устройство переустановили или сменили владельца
export async function registerPushToken(
	adminId: number,
	token: string,
	platform: 'ios' | 'android'
) {
	await db
		.insert(pushTokens)
		.values({ adminId, token, platform })
		.onConflictDoUpdate({
			target: pushTokens.token,
			set: { adminId, platform }
		})
}

export async function getAllPushTokens() {
	const rows = await db.select({ token: pushTokens.token }).from(pushTokens)
	return rows.map(r => r.token)
}
