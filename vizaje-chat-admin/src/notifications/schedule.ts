import type { DayKey, Schedule } from '../lib/api'

// зеркалит isOnlineAt из vizaje-chat-api/src/settings/service.ts — тот же
// расчёт (день недели и минуты в таймзоне графика через Intl, не локальное
// время браузера), чтобы звук уведомлений совпадал с тем, когда сервер
// реально шлёт push (см. notifyAdminsOfVisitorMessage)
function partsInScheduleTz(date: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(date)
	const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
	const day = get('weekday').toLowerCase().slice(0, 3) as DayKey
	const hour = Number(get('hour')) % 24
	const minute = Number(get('minute'))
	return { day, minutes: hour * 60 + minute }
}

function timeToMinutes(time: string) {
	const [h, m] = time.split(':').map(Number)
	return (h ?? 0) * 60 + (m ?? 0)
}

export function isWithinSchedule(schedule: Schedule, date = new Date()): boolean {
	const { day, minutes } = partsInScheduleTz(date, schedule.timezone)
	const d = schedule.days[day]
	if (!d?.enabled) return false
	return minutes >= timeToMinutes(d.start) && minutes < timeToMinutes(d.end)
}
