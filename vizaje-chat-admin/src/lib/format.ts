const timeFmt = new Intl.DateTimeFormat('ru-RU', {
	hour: '2-digit',
	minute: '2-digit'
})
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' })
const dateFmt = new Intl.DateTimeFormat('ru-RU', {
	day: '2-digit',
	month: '2-digit'
})

const DAY = 24 * 60 * 60 * 1000

// время сообщения: 14:05
export function formatTime(iso: string) {
	const d = new Date(iso)
	return Number.isNaN(d.getTime()) ? '' : timeFmt.format(d)
}

// для списка: сегодня — время, до недели назад — день недели, раньше — дата
export function formatListTime(iso: string) {
	const d = new Date(iso)
	const now = new Date()
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	if (d >= startOfToday) return timeFmt.format(d)
	if (now.getTime() - d.getTime() < 7 * DAY) return weekdayFmt.format(d)
	return dateFmt.format(d)
}

// инициалы оператора для аватара-бейджа: из имени до @, до 2 букв
export function initials(email: string) {
	const name = email.split('@')[0] ?? email
	const parts = name.split(/[.\-_]+/).filter(Boolean)
	const letters =
		parts.length >= 2 ? parts[0]![0] + parts[1]![0] : name.slice(0, 2)
	return letters.toUpperCase()
}
