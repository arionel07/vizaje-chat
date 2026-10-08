// Expo Push API: максимум 100 сообщений за один запрос, поэтому отправляем чанками
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const CHUNK_SIZE = 100

export async function sendExpoPush(
	tokens: string[],
	notification: { title: string; body: string; data?: Record<string, unknown> }
) {
	const expoTokens = tokens.filter(t => t.startsWith('ExponentPushToken'))
	if (expoTokens.length === 0) return

	for (let i = 0; i < expoTokens.length; i += CHUNK_SIZE) {
		const chunk = expoTokens.slice(i, i + CHUNK_SIZE)
		const messages = chunk.map(to => ({ to, ...notification }))
		try {
			await fetch(EXPO_PUSH_URL, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify(messages)
			})
		} catch (error) {
			// push — best-effort уведомление, не должно ронять обработку сообщения
			console.error('Failed to send Expo push notification:', error)
		}
	}
}
