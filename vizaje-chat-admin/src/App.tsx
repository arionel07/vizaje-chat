import { ChevronLeft, ChevronRight, MessageSquareText } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { LoginForm } from './auth/LoginForm'
import { ChatWindow } from './chat/ChatWindow'
import { ConversationList } from './conversations/ConversationList'
import {
	fetchCannedResponses,
	fetchMe,
	fetchOperators,
	type CannedResponse,
	type Conversation,
	type Operator
} from './lib/api'
import { SettingsPanel } from './settings/SettingsPanel'

// recharts тяжёлый — не тянем его в общий бандл тем, кто аналитику не открывает
const AnalyticsPage = lazy(() =>
	import('./analytics/AnalyticsPage').then(m => ({ default: m.AnalyticsPage }))
)

type Screen = 'chat' | 'settings' | 'analytics'

const panelClass =
	'min-w-0 flex-col overflow-hidden bg-white dark:bg-zinc-900 md:rounded-2xl md:border md:border-zinc-200 dark:md:border-zinc-800'

function App() {
	const [token, setToken] = useState(localStorage.getItem('admin_token'))
	const [selected, setSelected] = useState<Conversation | null>(null)
	const [refreshKey, setRefreshKey] = useState(0)
	const [operators, setOperators] = useState<Operator[]>([])
	const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([])
	const [screen, setScreen] = useState<Screen>('chat')
	// свой id — чтобы в чате понимать, какая из реакций на сообщении своя
	const [meId, setMeId] = useState<number | null>(null)
	// список бесед можно свернуть на ПК (больше места под чат); на телефоне
	// не используется — там список и так отдельный экран, своя логика showMain
	const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
		try {
			return localStorage.getItem('admin_sidebar_collapsed') === '1'
		} catch {
			return false
		}
	})
	function toggleSidebar() {
		setSidebarCollapsed(prev => {
			const next = !prev
			try {
				localStorage.setItem('admin_sidebar_collapsed', next ? '1' : '0')
			} catch {}
			return next
		})
	}

	// список для дропдауна «Назначить» в чате; меняется редко — грузим один раз на сессию
	useEffect(() => {
		if (!token) return
		fetchOperators(token).then(setOperators).catch(() => {})
	}, [token])

	useEffect(() => {
		if (!token) return
		fetchMe(token)
			.then(me => setMeId(me.id))
			.catch(() => {})
	}, [token])

	// список для панели шаблонов в чате; перезагружаем и после правок в настройках
	const loadCannedResponses = useCallback(() => {
		if (!token) return
		fetchCannedResponses(token).then(setCannedResponses).catch(() => {})
	}, [token])
	useEffect(loadCannedResponses, [loadCannedResponses])

	function logout() {
		localStorage.removeItem('admin_token')
		setSelected(null)
		setToken(null)
	}

	const refreshList = useCallback(() => setRefreshKey(k => k + 1), [])

	// свежие данные выбранной беседы из списка (статус, превью)
	const syncSelected = useCallback(
		(fresh: Conversation) =>
			setSelected(prev => (prev && prev.id === fresh.id ? fresh : prev)),
		[]
	)

	if (!token) {
		return <LoginForm onSuccess={setToken} />
	}

	const showMain = screen !== 'chat' || !!selected

	// Телефон: один экран — список или чат/настройки/аналитика. От md: две колонки.
	return (
		<div className="flex h-dvh md:gap-3 md:p-3">
			<aside
				className={`${panelClass} ${showMain ? 'hidden' : 'flex'} ${sidebarCollapsed ? 'md:hidden' : 'md:flex'} w-full md:w-[360px] md:shrink-0`}
			>
				<ConversationList
					token={token}
					onSelect={c => {
						setScreen('chat')
						setSelected(c)
					}}
					onSync={syncSelected}
					selectedId={selected?.id ?? null}
					refreshKey={refreshKey}
					onLogout={logout}
					onOpenSettings={() => {
						setSelected(null)
						setScreen('settings')
					}}
					onOpenAnalytics={() => {
						setSelected(null)
						setScreen('analytics')
					}}
				/>
			</aside>
			{/* «ручка» сворачивания списка бесед — только ПК; сидит между панелями,
			    не перекрывает содержимое ни одной из них (в отличие от плавающей
			    кнопки поверх шапки чата) */}
			<button
				type="button"
				onClick={toggleSidebar}
				aria-label={sidebarCollapsed ? 'Показать список бесед' : 'Скрыть список бесед'}
				title={sidebarCollapsed ? 'Показать список бесед' : 'Скрыть список бесед'}
				className="hidden w-4 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-zinc-200/60 hover:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 md:flex dark:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 dark:focus-visible:ring-zinc-300/30"
			>
				{sidebarCollapsed ? (
					<ChevronRight aria-hidden="true" className="h-4 w-4" />
				) : (
					<ChevronLeft aria-hidden="true" className="h-4 w-4" />
				)}
			</button>
			<main className={`${panelClass} ${showMain ? 'flex' : 'hidden md:flex'} flex-1`}>
				{screen === 'settings' ? (
					<SettingsPanel
						token={token}
						onBack={() => setScreen('chat')}
						onCannedResponsesChange={loadCannedResponses}
					/>
				) : screen === 'analytics' ? (
					<Suspense
						fallback={
							<p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">Загрузка…</p>
						}
					>
						<AnalyticsPage token={token} onBack={() => setScreen('chat')} />
					</Suspense>
				) : selected ? (
					<ChatWindow
						key={selected.id}
						token={token}
						conversation={selected}
						meId={meId}
						operators={operators}
						cannedResponses={cannedResponses}
						onBack={() => setSelected(null)}
						onActivity={refreshList}
						onStatusChange={status =>
							setSelected(prev => (prev ? { ...prev, status } : prev))
						}
						onAssigneeChange={(assigneeId, assigneeEmail) =>
							setSelected(prev => (prev ? { ...prev, assigneeId, assigneeEmail } : prev))
						}
						onDelete={() => {
							setSelected(null)
							refreshList()
						}}
					/>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-zinc-500 dark:text-zinc-400">
						<span className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
							<MessageSquareText aria-hidden="true" className="h-8 w-8" />
						</span>
						<p className="text-base font-medium text-zinc-900 dark:text-zinc-100">
							Выберите беседу
						</p>
						<p className="max-w-xs text-sm">
							Сообщения посетителей сайта появятся здесь
						</p>
					</div>
				)}
			</main>
		</div>
	)
}

export default App
