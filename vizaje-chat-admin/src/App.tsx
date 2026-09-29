import { useState } from 'react'
import { LoginForm } from './auth/LoginForm'
import { ChatWindow } from './chat/ChatWindow'
import { ConversationList } from './conversations/ConversationList'
function App() {
	const [token, setToken] = useState(localStorage.getItem('admin_token'))
	const [selectedId, setSelectedId] = useState<number | null>(null)
	const [refreshKey, setRefreshKey] = useState(0)

	function logout() {
		localStorage.removeItem('admin_token')
		setSelectedId(null)
		setToken(null)
	}

	if (!token) {
		return <LoginForm onSuccess={setToken} />
	}

	return (
		<div className="flex h-screen">
			<ConversationList
				token={token}
				onSelect={setSelectedId}
				selectedId={selectedId}
				refreshKey={refreshKey}
				onLogout={logout}
			/>
			<div className="flex-1">
				{selectedId ? (
					<ChatWindow
							token={token}
							conversationId={selectedId}
							onActivity={() => setRefreshKey(k => k + 1)}
						/>
				) : (
					<div className="p-[16px]">Выбери беседу слева</div>
				)}
			</div>
		</div>
	)
}

export default App
