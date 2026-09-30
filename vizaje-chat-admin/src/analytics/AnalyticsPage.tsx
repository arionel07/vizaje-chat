import { ChevronLeft, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis
} from 'recharts'
import {
	fetchAnalyticsOperators,
	fetchAnalyticsOverview,
	fetchAnalyticsTimeline,
	type AnalyticsOperatorStat,
	type AnalyticsOverview,
	type AnalyticsTimelinePoint
} from '../lib/api'
import { formatDuration, formatShortDate } from '../lib/format'

type Preset = '7' | '30' | 'custom'
const PRESETS: { id: Preset; label: string }[] = [
	{ id: '7', label: '7 дней' },
	{ id: '30', label: '30 дней' },
	{ id: 'custom', label: 'Период…' }
]

const todayISO = () => new Date().toISOString().slice(0, 10)
const daysAgoISO = (days: number) => {
	const d = new Date()
	d.setUTCDate(d.getUTCDate() - days)
	return d.toISOString().slice(0, 10)
}

const cardClass =
	'flex flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-800'

export function AnalyticsPage({ token, onBack }: { token: string; onBack: () => void }) {
	const [preset, setPreset] = useState<Preset>('7')
	// customFrom/customTo — черновик в полях; applied* — то, что реально ушло в запрос
	const [customFrom, setCustomFrom] = useState(daysAgoISO(6))
	const [customTo, setCustomTo] = useState(todayISO())

	const range = useMemo(() => {
		if (preset === 'custom') return { from: customFrom, to: customTo }
		const days = Number(preset)
		return { from: daysAgoISO(days - 1), to: todayISO() }
	}, [preset, customFrom, customTo])

	const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
	const [timeline, setTimeline] = useState<AnalyticsTimelinePoint[]>([])
	const [operators, setOperators] = useState<AnalyticsOperatorStat[]>([])
	const [loading, setLoading] = useState(true)
	const [loadFailed, setLoadFailed] = useState(false)

	useEffect(() => {
		// в «Период…» ждём, пока заполнены обе даты, и не шлём from > to
		if (preset === 'custom' && (!range.from || !range.to || range.from > range.to)) return
		let cancelled = false
		Promise.all([
			fetchAnalyticsOverview(token, range.from, range.to),
			fetchAnalyticsTimeline(token, range.from, range.to),
			fetchAnalyticsOperators(token, range.from, range.to)
		])
			.then(([o, t, ops]) => {
				if (cancelled) return
				setOverview(o)
				setTimeline(t)
				setOperators(ops)
				setLoadFailed(false)
			})
			.catch(() => !cancelled && setLoadFailed(true))
			.finally(() => !cancelled && setLoading(false))
		return () => {
			cancelled = true
		}
	}, [token, range.from, range.to, preset])

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex items-center gap-2 border-b border-zinc-200 px-2 py-3 dark:border-zinc-800 md:px-4">
				<button
					type="button"
					onClick={onBack}
					aria-label="Назад к беседам"
					className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 md:hidden"
				>
					<ChevronLeft aria-hidden="true" className="h-5 w-5" />
				</button>
				<h2 className="text-base font-semibold">Аналитика</h2>
			</header>

			<div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
				<div role="group" aria-label="Период" className="flex gap-2">
					{PRESETS.map(p => (
						<button
							key={p.id}
							type="button"
							aria-pressed={preset === p.id}
							onClick={() => setPreset(p.id)}
							className={`h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-300/30 ${
								preset === p.id
									? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
									: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
							}`}
						>
							{p.label}
						</button>
					))}
				</div>
				{preset === 'custom' && (
					<div className="flex items-center gap-2">
						<input
							type="date"
							value={customFrom}
							max={customTo}
							onChange={e => setCustomFrom(e.target.value)}
							aria-label="Начало периода"
							className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
						/>
						<span aria-hidden="true" className="text-sm text-zinc-400">
							–
						</span>
						<input
							type="date"
							value={customTo}
							min={customFrom}
							max={todayISO()}
							onChange={e => setCustomTo(e.target.value)}
							aria-label="Конец периода"
							className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20"
						/>
					</div>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
				{loadFailed && (
					<div
						role="alert"
						className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
					>
						<TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
						<span>Не удалось загрузить аналитику.</span>
					</div>
				)}

				{loading && !overview ? (
					<p className="text-sm text-zinc-500 dark:text-zinc-400">Загрузка…</p>
				) : (
					overview && (
						<>
							<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
								<div className={cardClass}>
									<span className="text-xs text-zinc-500 dark:text-zinc-400">Всего бесед</span>
									<span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
										{overview.total}
									</span>
								</div>
								<div className={cardClass}>
									<span className="text-xs text-zinc-500 dark:text-zinc-400">
										Открыто / закрыто
									</span>
									<span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
										{overview.open} / {overview.closed}
									</span>
								</div>
								<div className={cardClass}>
									<span className="text-xs text-zinc-500 dark:text-zinc-400">
										Среднее время ответа
									</span>
									<span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
										{formatDuration(overview.avgFirstResponseSeconds)}
									</span>
								</div>
								<div className={cardClass}>
									<span className="text-xs text-zinc-500 dark:text-zinc-400">С ответом</span>
									<span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
										{overview.respondedCount}
									</span>
								</div>
							</div>

							<div className="mt-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
								<h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
									Беседы по дням
								</h3>
								<div className="h-56">
									<ResponsiveContainer width="100%" height="100%">
										<LineChart data={timeline} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
											<XAxis
												dataKey="date"
												tickFormatter={formatShortDate}
												tick={{ fontSize: 12, fill: 'currentColor' }}
												className="text-zinc-500 dark:text-zinc-400"
												axisLine={false}
												tickLine={false}
											/>
											<YAxis
												allowDecimals={false}
												width={32}
												tick={{ fontSize: 12, fill: 'currentColor' }}
												className="text-zinc-500 dark:text-zinc-400"
												axisLine={false}
												tickLine={false}
											/>
											<Tooltip
												labelFormatter={label => formatShortDate(String(label ?? ''))}
												formatter={value => [String(value), 'Бесед']}
												contentStyle={{
													background: 'var(--tooltip-bg, #18181b)',
													border: 'none',
													borderRadius: 8,
													color: '#fff',
													fontSize: 13
												}}
											/>
											<Line
												type="monotone"
												dataKey="count"
												stroke="#18181b"
												className="dark:[stroke:#fff]"
												strokeWidth={2}
												dot={false}
											/>
										</LineChart>
									</ResponsiveContainer>
								</div>
							</div>

							<div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
								<h3 className="px-3 pt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
									По операторам
								</h3>
								{operators.length === 0 ? (
									<p className="px-3 py-4 text-sm text-zinc-500 dark:text-zinc-400">
										Операторов пока нет.
									</p>
								) : (
									<table className="mt-2 w-full min-w-[420px] border-collapse text-sm">
										<thead>
											<tr className="border-t border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
												<th className="px-3 py-2 font-medium">Оператор</th>
												<th className="px-3 py-2 font-medium">Назначено</th>
												<th className="px-3 py-2 font-medium">Закрыто</th>
												<th className="px-3 py-2 font-medium">Среднее время ответа</th>
											</tr>
										</thead>
										<tbody>
											{operators.map(op => (
												<tr
													key={op.id}
													className="border-t border-zinc-100 dark:border-zinc-800/60"
												>
													<td className="px-3 py-2 text-zinc-900 dark:text-zinc-100">
														{op.email}
													</td>
													<td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
														{op.assigned}
													</td>
													<td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
														{op.closed}
													</td>
													<td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
														{formatDuration(op.avgFirstResponseSeconds)}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								)}
							</div>
						</>
					)
				)}
			</div>
		</div>
	)
}
