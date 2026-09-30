import { Check, ChevronLeft, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchSchedule, updateSchedule, type DayKey, type Schedule } from '../lib/api'

const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<DayKey, string> = {
	mon: 'Понедельник',
	tue: 'Вторник',
	wed: 'Среда',
	thu: 'Четверг',
	fri: 'Пятница',
	sat: 'Суббота',
	sun: 'Воскресенье'
}

const inputClass =
	'h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20'

// Рабочий график: вне этих часов виджет предупреждает посетителя, что оператора
// сейчас нет — не блокирует отправку сообщений, только честно об этом говорит
export function ScheduleSettings({ token, onBack }: { token: string; onBack: () => void }) {
	const [schedule, setSchedule] = useState<Schedule | null>(null)
	const [loading, setLoading] = useState(true)
	const [loadFailed, setLoadFailed] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	useEffect(() => {
		fetchSchedule(token)
			.then(setSchedule)
			.catch(() => setLoadFailed(true))
			.finally(() => setLoading(false))
	}, [token])

	function updateDay(day: DayKey, patch: Partial<Schedule['days'][DayKey]>) {
		setSchedule(prev =>
			prev ? { ...prev, days: { ...prev.days, [day]: { ...prev.days[day], ...patch } } } : prev
		)
		setSaved(false)
	}

	async function handleSave() {
		if (!schedule) return
		setSaving(true)
		setError(null)
		try {
			setSchedule(await updateSchedule(token, schedule.days))
			setSaved(true)
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Не удалось сохранить')
		} finally {
			setSaving(false)
		}
	}

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
				<h2 className="text-base font-semibold">Рабочий график</h2>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
				{loading && <p className="text-sm text-zinc-500 dark:text-zinc-400">Загрузка…</p>}

				{loadFailed && (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
					>
						<TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
						<span>Не удалось загрузить график.</span>
					</div>
				)}

				{schedule && (
					<>
						<p className="mb-4 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
							Часовой пояс зафиксирован: {schedule.timezone}. Вне этих часов виджет
							предупреждает посетителя, что сейчас никто не онлайн — отправить сообщение
							можно в любое время, оно останется ждать оператора.
						</p>

						<div className="flex flex-col gap-2">
							{DAY_ORDER.map(day => {
								const d = schedule.days[day]
								return (
									<div
										key={day}
										className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
									>
										<label className="flex w-40 shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
											<input
												type="checkbox"
												checked={d.enabled}
												onChange={e => updateDay(day, { enabled: e.target.checked })}
												className="h-4 w-4 shrink-0 cursor-pointer rounded border-zinc-300 text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
											/>
											{DAY_LABELS[day]}
										</label>
										<input
											type="time"
											value={d.start}
											disabled={!d.enabled}
											onChange={e => updateDay(day, { start: e.target.value })}
											aria-label={`${DAY_LABELS[day]}: начало`}
											className={inputClass}
										/>
										<span aria-hidden="true" className="text-sm text-zinc-400">
											–
										</span>
										<input
											type="time"
											value={d.end}
											disabled={!d.enabled}
											onChange={e => updateDay(day, { end: e.target.value })}
											aria-label={`${DAY_LABELS[day]}: конец`}
											className={inputClass}
										/>
									</div>
								)
							})}
						</div>

						{error && (
							<p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
								{error}
							</p>
						)}

						<button
							type="button"
							onClick={handleSave}
							disabled={saving}
							className="mt-4 flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
						>
							{saved && !saving && <Check aria-hidden="true" className="h-4 w-4" />}
							{saving ? 'Сохранение…' : saved ? 'Сохранено' : 'Сохранить'}
						</button>
					</>
				)}
			</div>
		</div>
	)
}
