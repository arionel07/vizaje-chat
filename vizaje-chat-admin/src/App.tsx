import { MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { LoginForm } from './auth/LoginForm'
import { ChatWindow } from './chat/ChatWindow'
import { ConversationList } from './conversations/ConversationList'
import { fetchOperators, type Conversation, type Operator } from './lib/api'
import { ScheduleSettings } from './settings/ScheduleSettings'

const panelClass =
	'min-w-0 flex-col overflow-hidden bg-white dark:bg-zinc-900 md:rounded-2xl md:border md:border-zinc-200 dark:md:border-zinc-800'

function App() {
	const [token, setToken] = useState(localStorage.getItem('admin_token'))
	const [selected, setSelected] = useState<Conversation | null>(null)
	const [refreshKey, setRefreshKey] = useState(0)
	const [operators, setOperators] = useState<Operator[]>([])
	const [showSettings, setShowSettings] = useState(false)

	// список для дропдауна «Назначить» в чате; меняется редко — грузим один раз на сессию
	useEffect(() => {
		if (!token) return
		fetchOperators(token).then(setOperators).catch(() => {})
	}, [token])

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

	// Телефон: один экран — список или чат. От md: две колонки.
	return (
		<div className="flex h-dvh md:gap-3 md:p-3">
			<aside
				className={`${panelClass} ${selected || showSettings ? 'hidden md:flex' : 'flex'} w-full md:w-[360px] md:shrink-0`}
			>
				<ConversationList
					token={token}
					onSelect={c => {
						setShowSettings(false)
						setSelected(c)
					}}
					onSync={syncSelected}
					selectedId={selected?.id ?? null}
					refreshKey={refreshKey}
					onLogout={logout}
					onOpenSettings={() => {
						setSelected(null)
						setShowSettings(true)
					}}
				/>
			</aside>
			<main
				className={`${panelClass} ${selected || showSettings ? 'flex' : 'hidden md:flex'} flex-1`}
			>
				{showSettings ? (
					<ScheduleSettings token={token} onBack={() => setShowSettings(false)} />
				) : selected ? (
					<ChatWindow
						key={selected.id}
						token={token}
						conversation={selected}
						operators={operators}
						onBack={() => setSelected(null)}
						onActivity={refreshList}
						onStatusChange={status =>
							setSelected(prev => (prev ? { ...prev, status } : prev))
						}
						onAssigneeChange={(assigneeId, assigneeEmail) =>
							setSelected(prev => (prev ? { ...prev, assigneeId, assigneeEmail } : prev))
						}
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
