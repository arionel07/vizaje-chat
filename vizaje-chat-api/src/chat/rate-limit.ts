// Скользящее окно в памяти процесса: не более `max` событий за `windowMs` на ключ
export function createLimiter(windowMs: number, max: number) {
	const hits = new Map<string | number, number[]>()

	// чистим устаревшие ключи, чтобы Map не росла бесконечно
	setInterval(() => {
		const now = Date.now()
		for (const [key, times] of hits) {
			if (times.every(t => now - t >= windowMs)) hits.delete(key)
		}
	}, windowMs).unref()

	return function allow(key: string | number): boolean {
		const now = Date.now()
		const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs)
		if (recent.length >= max) {
			hits.set(key, recent)
			return false
		}
		recent.push(now)
		hits.set(key, recent)
		return true
	}
}

// сообщения посетителя: 5 за 10 секунд на беседу
export const allowVisitorMessage = createLimiter(10_000, 5)
// попытки входа админа: 10 за 15 минут на IP
export const allowLoginAttempt = createLimiter(15 * 60_000, 10)
// создание widget-сессий: 10 в час на IP
export const allowSessionCreate = createLimiter(60 * 60_000, 10)
