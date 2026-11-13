// Service worker только для Web Push — показывает системные уведомления,
// даже когда вкладка админки не открыта или телефон заблокирован (на iOS —
// после «Добавить на экран Домой», это ограничение самого iOS, не наше).
// Больше ничего не кеширует и не перехватывает — не офлайн-режим.

self.addEventListener('push', event => {
	if (!event.data) return
	let payload
	try {
		payload = event.data.json()
	} catch {
		return
	}
	const { title, body, data } = payload
	event.waitUntil(
		self.registration.showNotification(title || 'Vizaje-Nica', {
			body,
			icon: '/favicon.svg',
			tag: data?.conversationId ? `conversation-${data.conversationId}` : undefined,
			renotify: !!data?.conversationId,
			data
		})
	)
})

// клик по уведомлению — фокусирует уже открытую вкладку админки или открывает новую
self.addEventListener('notificationclick', event => {
	event.notification.close()
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
			for (const client of clients) {
				if ('focus' in client) return client.focus()
			}
			if (self.clients.openWindow) return self.clients.openWindow('/')
		})
	)
})
