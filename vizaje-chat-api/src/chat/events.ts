type Publisher = (room: string, payload: string) => unknown

let publisher: Publisher | null = null

// подключается в index.ts после старта сервера
export function setPublisher(fn: Publisher) {
	publisher = fn
}

// служебное событие (не сообщение): { type: 'read' | 'typing' | ... }
export function publishToRoom(room: string, event: unknown) {
	publisher?.(room, JSON.stringify(event))
}
export const publishToConversation = (conversationId: number, event: unknown) =>
	publishToRoom(`conversation:${conversationId}`, event)
export const publishToAdmins = (event: unknown) =>
	publishToRoom('admin:global', event)

// для публикации вне WS-хендлера (HTTP-роуты, сервисы); payload — уже JSON-строка
export function publishMessage(conversationId: number, message: unknown) {
	const payload = JSON.stringify(message)
	publisher?.(`conversation:${conversationId}`, payload)
	publisher?.('admin:global', payload)
}
