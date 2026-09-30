import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { settings } from '../db/schema'

// таймзона фиксированная (не настраивается через API) — так и задумано на старте
export const SCHEDULE_TIMEZONE = 'Europe/Chisinau'

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export type DaySchedule = { enabled: boolean; start: string; end: string } // start/end — "HH:MM"
export type Schedule = { timezone: string; days: Record<DayKey, DaySchedule> }

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<DayKey, string> = {
	mon: 'Пн',
	tue: 'Вт',
	wed: 'Ср',
	thu: 'Чт',
	fri: 'Пт',
	sat: 'Сб',
	sun: 'Вс'
}
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const DEFAULT_SCHEDULE: Schedule = {
	timezone: SCHEDULE_TIMEZONE,
	days: {
		mon: { enabled: true, start: '09:00', end: '18:00' },
		tue: { enabled: true, start: '09:00', end: '18:00' },
		wed: { enabled: true, start: '09:00', end: '18:00' },
		thu: { enabled: true, start: '09:00', end: '18:00' },
		fri: { enabled: true, start: '09:00', end: '18:00' },
		sat: { enabled: false, start: '09:00', end: '18:00' },
		sun: { enabled: false, start: '09:00', end: '18:00' }
	}
}

const SCHEDULE_KEY = 'schedule'

// строгая проверка формы: все 7 дней, время HH:MM, начало раньше конца
export function validateSchedule(input: unknown): Schedule {
	if (!input || typeof input !== 'object' || !('days' in input)) {
		throw new Error('Invalid schedule')
	}
	const rawDays = (input as { days: unknown }).days
	if (!rawDays || typeof rawDays !== 'object') throw new Error('Invalid schedule')

	const days = {} as Record<DayKey, DaySchedule>
	for (const key of DAY_KEYS) {
		const d = (rawDays as Record<string, unknown>)[key] as
			| Partial<DaySchedule>
			| undefined
		if (!d || typeof d !== 'object') throw new Error(`Отсутствует день: ${key}`)
		if (typeof d.enabled !== 'boolean')
			throw new Error(`${key}.enabled должен быть boolean`)
		if (typeof d.start !== 'string' || !TIME_RE.test(d.start))
			throw new Error(`${key}.start должен быть в формате HH:MM`)
		if (typeof d.end !== 'string' || !TIME_RE.test(d.end))
			throw new Error(`${key}.end должен быть в формате HH:MM`)
		if (d.enabled && d.start >= d.end)
			throw new Error(`${key}: начало должно быть раньше конца`)
		days[key] = { enabled: d.enabled, start: d.start, end: d.end }
	}
	return { timezone: SCHEDULE_TIMEZONE, days }
}

// повреждённые данные в БД не должны ронять сервис — откатываемся к дефолту
function normalizeSchedule(value: unknown): Schedule {
	try {
		return validateSchedule(value)
	} catch {
		return DEFAULT_SCHEDULE
	}
}

export async function getSchedule(): Promise<Schedule> {
	const [row] = await db
		.select({ value: settings.value })
		.from(settings)
		.where(eq(settings.key, SCHEDULE_KEY))
	return row ? normalizeSchedule(row.value) : DEFAULT_SCHEDULE
}

export async function setSchedule(input: unknown): Promise<Schedule> {
	const schedule = validateSchedule(input)
	await db
		.insert(settings)
		.values({ key: SCHEDULE_KEY, value: schedule, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: schedule, updatedAt: new Date() }
		})
	return schedule
}

// день недели и время в фиксированной таймзоне графика — не зависит от TZ сервера
function partsInScheduleTz(date: Date) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: SCHEDULE_TIMEZONE,
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(date)
	const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
	// 'Mon' | 'Tue' | ... -> 'mon' | 'tue' | ...
	const day = get('weekday').toLowerCase().slice(0, 3) as DayKey
	// час "24" в некоторых движках вместо "00" при hour12:false — приводим к 0..23
	const hour = Number(get('hour')) % 24
	const minute = Number(get('minute'))
	return { day, minutes: hour * 60 + minute }
}

function timeToMinutes(time: string) {
	const [h, m] = time.split(':').map(Number)
	return h! * 60 + m!
}

export function isOnlineAt(schedule: Schedule, date: Date) {
	const { day, minutes } = partsInScheduleTz(date)
	const d = schedule.days[day]
	if (!d?.enabled) return false
	return minutes >= timeToMinutes(d.start) && minutes < timeToMinutes(d.end)
}

const SEARCH_STEP_MS = 60_000
const SEARCH_MAX_STEPS = 8 * 24 * 60 // до 8 дней вперёд с шагом в минуту

// { online, nextOnlineAt } — nextOnlineAt заполнен, только если offline и график
// не выключен целиком; ищем минутными шагами, без ручной арифметики DST-переходов
export function getStatus(schedule: Schedule, now = new Date()) {
	if (isOnlineAt(schedule, now)) return { online: true as const, nextOnlineAt: null }

	let t = new Date(now.getTime())
	t.setSeconds(0, 0)
	t = new Date(t.getTime() + SEARCH_STEP_MS)
	for (let i = 0; i < SEARCH_MAX_STEPS; i++) {
		if (isOnlineAt(schedule, t)) {
			return { online: false as const, nextOnlineAt: t.toISOString() }
		}
		t = new Date(t.getTime() + SEARCH_STEP_MS)
	}
	return { online: false as const, nextOnlineAt: null } // все дни выключены
}

// человекочитаемая сводка для баннера в виджете, например "Пн–Пт 09:00–18:00, Сб 10:00–14:00":
// склеивает подряд идущие дни с одинаковым интервалом в один диапазон
export function summarizeSchedule(schedule: Schedule) {
	type Run = { from: DayKey; to: DayKey; start: string; end: string }
	const runs: Run[] = []
	DAY_KEYS.forEach((key, i) => {
		const d = schedule.days[key]
		if (!d.enabled) return
		const run = runs.at(-1)
		// продолжает предыдущий диапазон, только если день идёт сразу за ним
		// (а не просто где-то дальше с тем же временем)
		const adjacent = run && DAY_KEYS[i - 1] === run.to
		if (run && adjacent && run.start === d.start && run.end === d.end) {
			run.to = key
		} else {
			runs.push({ from: key, to: key, start: d.start, end: d.end })
		}
	})
	return runs
		.map(r => {
			const label =
				r.from === r.to ? DAY_LABELS[r.from] : `${DAY_LABELS[r.from]}–${DAY_LABELS[r.to]}`
			return `${label} ${r.start}–${r.end}`
		})
		.join(', ')
}
