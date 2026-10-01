import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { BotResponsesSettings } from './BotResponsesSettings'
import { CannedResponsesSettings } from './CannedResponsesSettings'
import { ScheduleSettings } from './ScheduleSettings'

type Tab = 'schedule' | 'canned' | 'bot'
const TABS: { id: Tab; label: string }[] = [
	{ id: 'schedule', label: 'Рабочий график' },
	{ id: 'canned', label: 'Шаблоны ответов' },
	{ id: 'bot', label: 'Ответы бота' }
]

export function SettingsPanel({
	token,
	onBack,
	onCannedResponsesChange
}: {
	token: string
	onBack: () => void // на телефоне — вернуться к списку бесед
	onCannedResponsesChange: () => void // шаблоны изменились — обновить список в App (для панели в чате)
}) {
	const [tab, setTab] = useState<Tab>('schedule')

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
				<h2 className="text-base font-semibold">Настройки</h2>
			</header>

			<div
				role="tablist"
				aria-label="Раздел настроек"
				className="flex gap-2 overflow-x-auto border-b border-zinc-200 px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden dark:border-zinc-800"
			>
				{TABS.map(t => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						onClick={() => setTab(t.id)}
						className={`h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-300/30 ${
							tab === t.id
								? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
								: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				{tab === 'schedule' ? (
					<ScheduleSettings token={token} />
				) : tab === 'canned' ? (
					<CannedResponsesSettings token={token} onChange={onCannedResponsesChange} />
				) : (
					<BotResponsesSettings token={token} />
				)}
			</div>
		</div>
	)
}
