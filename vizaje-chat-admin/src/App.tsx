import { useState } from 'react'
import { LoginForm } from './auth/LoginForm'
import { ChatWindow } from './chat/ChatWindow'
import { ConversationList } from './conversations/ConversationList'
function App() {
	const [token, setToken] = useState(localStorage.getItem('admin_token'))
	const [selectedId, setSelectedId] = useState<number | null>(null)

	if (!token) {
		return <LoginForm onSuccess={setToken} />
	}

	return (
		<div style={{ display: 'flex', height: '100vh' }}>
			<ConversationList
				token={token}
				onSelect={setSelectedId}
				selectedId={selectedId}
			/>
			<div style={{ flex: 1 }}>
				{selectedId ? (
					<ChatWindow token={token} conversationId={selectedId} />
				) : (
					<div style={{ padding: 16 }}>Выбери беседу слева</div>
				)}
			</div>
			<div style={{ flex: 1, padding: 16 }}>
				{selectedId ? `Выбрана беседа #${selectedId}` : 'Выбери беседу слева'}
			</div>
		</div>
	)
}

export default App
