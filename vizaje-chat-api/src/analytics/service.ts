import { and, gte, lt, sql } from 'drizzle-orm'
import { db } from '../db/client'
import { getOperators } from '../chat/service'
import { conversations } from '../db/schema'

const MS_PER_DAY = 24 * 60 * 60 * 1000
export const DEFAULT_RANGE_DAYS = 7

// «to» без времени (просто дата) как верхняя граница отсекла бы весь этот день —
// считаем такую дату включительно, до его конца
function endOfDayIfDateOnly(raw: string, date: Date) {
	return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(date.getTime() + MS_PER_DAY) : date
}

// период по умолчанию — последние 7 дней до текущего момента; from/to — ISO-строки с фронта
export function resolveRange(from?: string, to?: string) {
	const now = new Date()
	const toDate = to ? endOfDayIfDateOnly(to, new Date(to)) : now
	if (Number.isNaN(toDate.getTime())) throw new Error('Invalid "to" date')

	const fromDate = from ? new Date(from) : new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * MS_PER_DAY)
	if (Number.isNaN(fromDate.getTime())) throw new Error('Invalid "from" date')

	if (fromDate > toDate) throw new Error('"from" must be before "to"')
	return { from: fromDate, to: toDate }
}

// Drizzle в коррелированных подзапросах теряет имя таблицы у "id" — как и в
// chat/service.ts, квалифицируем внешнюю колонку вручную
const convId = sql`"conversations"."id"`

const firstVisitorAtExpr = () => sql`(
	select min(m.created_at) from messages m
	where m.conversation_id = ${convId} and m.sender = 'visitor'
)`
const firstAdminAtExpr = () => sql`(
	select min(m.created_at) from messages m
	where m.conversation_id = ${convId} and m.sender = 'admin'
)`

// среднее время первого ответа в секундах по уже готовым парам меток времени
function averageFirstResponseSeconds(
	rows: { firstVisitorAt: Date | string | null; firstAdminAt: Date | string | null }[]
) {
	const seconds = rows
		.filter(r => r.firstVisitorAt && r.firstAdminAt)
		.map(
			r => (new Date(r.firstAdminAt!).getTime() - new Date(r.firstVisitorAt!).getTime()) / 1000
		)
		.filter(s => s >= 0) // защита от рассинхронизации часов/данных
	if (!seconds.length) return null
	return Math.round(seconds.reduce((a, b) => a + b, 0) / seconds.length)
}

// Сводка за период: всего бесед, открыто/закрыто (по текущему статусу),
// среднее время первого ответа оператора (от первого сообщения посетителя
// до первого сообщения админа в той же беседе)
export async function getOverview({ from, to }: { from: Date; to: Date }) {
	const rows = await db
		.select({
			status: conversations.status,
			firstVisitorAt: sql<string | null>`${firstVisitorAtExpr()}`,
			firstAdminAt: sql<string | null>`${firstAdminAtExpr()}`
		})
		.from(conversations)
		.where(and(gte(conversations.createdAt, from), lt(conversations.createdAt, to)))

	const respondedRows = rows.filter(r => r.firstVisitorAt && r.firstAdminAt)

	return {
		total: rows.length,
		open: rows.filter(r => r.status === 'open').length,
		closed: rows.filter(r => r.status === 'closed').length,
		avgFirstResponseSeconds: averageFirstResponseSeconds(rows),
		// на скольких беседах основано среднее — остальные ещё без ответа админа
		respondedCount: respondedRows.length
	}
}

// количество новых бесед по дням; дни без бесед внутри диапазона идут нулями,
// чтобы график не рвался
export async function getTimeline({ from, to }: { from: Date; to: Date }) {
	const rows = await db
		.select({
			day: sql<string>`to_char(date_trunc('day', ${conversations.createdAt}), 'YYYY-MM-DD')`,
			count: sql<number>`count(*)::int`
		})
		.from(conversations)
		.where(and(gte(conversations.createdAt, from), lt(conversations.createdAt, to)))
		.groupBy(sql`date_trunc('day', ${conversations.createdAt})`)

	const byDay = new Map(rows.map(r => [r.day, r.count]))
	const points: { date: string; count: number }[] = []
	const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
	// to — исключающая верхняя граница (см. resolveRange); последний день диапазона на 1мс раньше
	const lastMoment = new Date(to.getTime() - 1)
	const end = new Date(
		Date.UTC(lastMoment.getUTCFullYear(), lastMoment.getUTCMonth(), lastMoment.getUTCDate())
	)
	while (cursor <= end) {
		const key = cursor.toISOString().slice(0, 10)
		points.push({ date: key, count: byDay.get(key) ?? 0 })
		cursor.setUTCDate(cursor.getUTCDate() + 1)
	}
	return points
}

// По каждому оператору: сколько бесед назначено и закрыто за период, среднее
// время первого ответа. Ограничение: сообщения не хранят автора-оператора
// (только sender: 'admin'), поэтому время ответа считается по беседе в целом
// и приписывается текущему назначенному оператору, а не тому, кто фактически
// ответил
export async function getOperatorsStats({ from, to }: { from: Date; to: Date }) {
	const rows = await db
		.select({
			assigneeId: conversations.assigneeId,
			status: conversations.status,
			firstVisitorAt: sql<string | null>`${firstVisitorAtExpr()}`,
			firstAdminAt: sql<string | null>`${firstAdminAtExpr()}`
		})
		.from(conversations)
		.where(and(gte(conversations.createdAt, from), lt(conversations.createdAt, to)))

	const operators = await getOperators()
	return operators.map(op => {
		const own = rows.filter(r => r.assigneeId === op.id)
		return {
			id: op.id,
			email: op.email,
			assigned: own.length,
			closed: own.filter(r => r.status === 'closed').length,
			avgFirstResponseSeconds: averageFirstResponseSeconds(own)
		}
	})
}
