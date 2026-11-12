import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL } from '../config'

// тонкая обёртка над DeepSeek — OpenAI-совместимый chat/completions, без
// отдельного SDK (DeepSeek его не публикует для TS, да и незачем: нужен
// только этот один эндпоинт). Сырой fetch, как в telegram/service.ts

export type ChatMessage =
	| { role: 'system'; content: string }
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
	| { role: 'tool'; content: string; tool_call_id: string }

export type ToolCall = {
	id: string
	type: 'function'
	function: { name: string; arguments: string }
}

export type ToolDef = {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: Record<string, unknown>
	}
}

type ChatCompletionResponse = {
	choices: {
		message: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
		finish_reason: string
	}[]
}

// url/key — переменные, не константы: тесты подменяют их через setDeepseekConfig,
// тот же приём, что host/searchKey/index в products/service.ts
let apiKey = DEEPSEEK_API_KEY
let baseUrl = DEEPSEEK_BASE_URL
let model = DEEPSEEK_MODEL

export function setDeepseekConfig(
	overrides: Partial<{ apiKey: string | null; baseUrl: string; model: string }>
) {
	if ('apiKey' in overrides) apiKey = overrides.apiKey ?? null
	if ('baseUrl' in overrides) baseUrl = overrides.baseUrl ?? baseUrl
	if ('model' in overrides) model = overrides.model ?? model
}

export const isDeepseekConfigured = () => Boolean(apiKey)

type Fetcher = (url: string, init: RequestInit) => Promise<Response>
let fetcher: Fetcher = fetch
export function setDeepseekFetcher(fn: Fetcher) {
	fetcher = fn
}

// jsonMode — требовать валидный JSON-объект в content (для финального ответа
// с текстом + кнопками); при tool_calls это не применяется (DeepSeek сам не
// отдаёт JSON+tool_calls одновременно, финальный текст — отдельный ход)
export async function chatCompletion(
	messages: ChatMessage[],
	{ tools, jsonMode }: { tools?: ToolDef[]; jsonMode?: boolean } = {}
) {
	if (!apiKey) throw new Error('DeepSeek is not configured')
	const res = await fetcher(`${baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model,
			messages,
			...(tools ? { tools, tool_choice: 'auto' } : {}),
			...(jsonMode ? { response_format: { type: 'json_object' } } : {})
		})
	})
	if (!res.ok) {
		throw new Error(`DeepSeek request failed: ${res.status} ${await res.text().catch(() => '')}`)
	}
	const data = (await res.json()) as ChatCompletionResponse
	const choice = data.choices[0]
	if (!choice) throw new Error('DeepSeek returned no choices')
	return choice.message
}
