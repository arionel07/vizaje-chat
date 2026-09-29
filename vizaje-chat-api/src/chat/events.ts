type Publisher = (room: string, payload: string) => unknown

let publisher: Publisher | null = null

// подключается в index.ts после старта сервера
export function setPublisher(fn: Publisher) {
	publisher = fn
}

// для публикации вне WS-хендлера (HTTP-роуты, сервисы); payload — уже JSON-строка
export function publishMessage(conversationId: number, message: unknown) {
	const payload = JSON.stringify(message)
	publisher?.(`conversation:${conversationId}`, payload)
	publisher?.('admin:global', payload)
}
