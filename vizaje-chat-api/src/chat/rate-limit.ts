const WINDOW_MS = 10_000
const MAX_MESSAGES = 5

// conversationId -> временные метки последних сообщений (в памяти процесса)
const hits = new Map<number, number[]>()

export function allowVisitorMessage(conversationId: number): boolean {
	const now = Date.now()
	const recent = (hits.get(conversationId) ?? []).filter(
		t => now - t < WINDOW_MS
	)
	if (recent.length >= MAX_MESSAGES) {
		hits.set(conversationId, recent)
		return false
	}
	recent.push(now)
	hits.set(conversationId, recent)
	return true
}
